import { errorMessage } from "@/api/errors";
import { uuid } from "@/api/ids";
import type { StreamHandlers } from "@/api/sse";
import type { ContractReviewResponse, RedlineSuggestion, ReviewDepth, ReviewFlag } from "@/api/types";
import { clauseFixPrompt, contractReviewPrompt, normalizeReviewDepth } from "@/ai/prompts";
import { groundingFor } from "@/lib/grounding";
import { IncompleteAnswerError, runJson } from "./llm";

/**
 * Community port of the contract-review streams (redlines + the agentic
 * "draft a stronger fix"). Emits the SAME type-in-JSON SSE events the backend
 * legal-tool streams do (init / progress / result / error / done), so the review
 * UI (src/api/contract-review.ts consumer) is untouched.
 *
 * The backend's grounding gate is mimicked here: a redline is only marked
 * "verified" (safe to auto-apply) when its currentLanguage is a literal substring
 * of the contract; anything the model could not anchor is downgraded to
 * "unverified" so it is shown but never auto-applied.
 *
 * FAIL-SAFE: a "result" event is sent ONLY for a review that is provably
 * complete: the model finished on its own (no truncation, refusal or dropped
 * stream), the JSON parsed, it ends with "reviewComplete": true, and every
 * required field is present. Anything else is an "error" event. An empty
 * redline list therefore means "reviewed in full and nothing found", never
 * "the answer was lost".
 */

/** Output budget for one review pass: thinking + the full JSON review. A real
 *  review of the 12-clause sample needed about 13,700 output tokens on Claude
 *  Opus 5.5 (ArkLaw Desktop, 17 Nov 2026), so 4,096 cut it off. */
export const REVIEW_MAX_TOKENS = 32_000;

/**
 * The output budget actually used. TEST BUILDS ONLY: building with
 * VITE_ARKLAW_TEST_TRUNCATE_REVIEW_AT=<n> (n below 2,000) forces a tiny budget so
 * every review is cut off and the fail-safe error can be checked inside Word.
 * Production builds never set it, and any other value is ignored. Exported for
 * tests.
 */
export function reviewMaxTokens(forced: unknown = import.meta.env.VITE_ARKLAW_TEST_TRUNCATE_REVIEW_AT): number {
  const n = Number(forced ?? 0);
  return Number.isInteger(n) && n > 0 && n < 2_000 ? n : REVIEW_MAX_TOKENS;
}

const SEVERITY_RANK: Record<NonNullable<RedlineSuggestion["severity"]>, number> = { high: 0, medium: 1, low: 2 };

/** A review answer that arrived but is not a complete, well-formed review. */
export class IncompleteReviewError extends Error {
  constructor(readonly problem: string) {
    super(`The AI's answer was missing part of the review (${problem}).`);
    this.name = "IncompleteReviewError";
  }
}

/** The lawyer-facing message for a review that did not complete. */
export function reviewFailureMessage(e: unknown): string {
  let reason: string;
  if (e instanceof IncompleteAnswerError) {
    reason =
      e.finish === "truncated"
        ? "The AI's answer was cut off before it finished (it reached its length limit)."
        : e.finish === "refused"
          ? "The AI declined to complete it."
          : e.finish === "unreadable"
            ? "The AI's answer could not be read."
            : "The AI's answer stopped before it finished.";
  } else if (e instanceof IncompleteReviewError) {
    reason = e.message;
  } else {
    reason = errorMessage(e);
  }
  return `Review not completed. ${reason} Nothing has been marked as reviewed or clean. Please try again.`;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Why `raw` is not a complete review, or null when it is. Exported for tests.
 * Checks the completion marker first: a JSON object that parses but lacks it
 * was cut short (or the model ignored the schema), so it cannot be trusted.
 */
export function reviewProblem(raw: unknown): string | null {
  if (!isObject(raw)) return "no review object";
  if (raw.reviewComplete !== true) return "no completion marker";
  if (typeof raw.summary !== "string" || !raw.summary.trim()) return "no summary";
  if (raw.overallRisk !== "green" && raw.overallRisk !== "yellow" && raw.overallRisk !== "red") {
    return "no overall risk";
  }
  if (!Array.isArray(raw.redlines)) return "no list of changes";
  for (const [i, r] of raw.redlines.entries()) {
    if (!isObject(r)) return `change ${i + 1} is not readable`;
    if (typeof r.clauseName !== "string" || !r.clauseName.trim()) return `change ${i + 1} has no clause name`;
    if (typeof r.currentLanguage !== "string") return `change ${i + 1} has no current wording`;
    if (typeof r.proposedLanguage !== "string") return `change ${i + 1} has no proposed wording`;
    if (typeof r.rationale !== "string" || !r.rationale.trim()) return `change ${i + 1} has no explanation`;
  }
  for (const key of ["flags", "missingClauses", "negotiationPriorities"] as const) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) return `${key} is not a list`;
  }
  return null;
}

function severityFrom(o: Record<string, unknown>): NonNullable<RedlineSuggestion["severity"]> {
  if (o.severity === "high" || o.severity === "medium" || o.severity === "low") return o.severity;
  // The model left it out: rate conservatively rather than defaulting to "low".
  if (o.isDealBreaker === true) return "high";
  if (o.nature === "housekeeping") return "low";
  return "medium";
}

function normalizeRedline(r: unknown, doc: string): RedlineSuggestion {
  const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
  const currentLanguage = str(o.currentLanguage);
  // "verified" only when the wording occurs exactly once (audit finding F07).
  const { grounding, groundingNote } = groundingFor(currentLanguage, doc);
  const nature =
    o.nature === "housekeeping" ? "housekeeping" : o.nature === "substantive" ? "substantive" : undefined;
  return {
    clauseName: str(o.clauseName, "Clause"),
    sectionReference: typeof o.sectionReference === "string" ? o.sectionReference : null,
    currentLanguage,
    proposedLanguage: str(o.proposedLanguage),
    rationale: str(o.rationale),
    fallbackPosition: typeof o.fallbackPosition === "string" ? o.fallbackPosition : null,
    grounding,
    ...(groundingNote ? { groundingNote } : {}),
    approvalLevel: null,
    isDealBreaker: o.isDealBreaker === true,
    nature,
    severity: severityFrom(o),
    fromInstruction:
      typeof o.fromInstruction === "string" && o.fromInstruction.trim() ? o.fromInstruction.trim() : null,
  };
}

function normalizeFlag(f: unknown): ReviewFlag | null {
  const o = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
  const observation = str(o.observation).trim();
  if (!observation) return null;
  const quote = str(o.quote).trim();
  return {
    clauseName: str(o.clauseName, "Note").trim() || "Note",
    sectionReference: typeof o.sectionReference === "string" && o.sectionReference ? o.sectionReference : undefined,
    observation,
    ...(quote ? { quote } : {}),
  };
}

/**
 * Rank findings (high, medium, low; ties keep the model's order) and, outside
 * Comprehensive mode, set aside ONLY cosmetic tidy-ups (housekeeping AND low
 * severity) that no reviewer instruction asked for. Their number is returned
 * so the UI can say how many were left out; nothing material is ever hidden.
 * Exported for tests.
 */
export function rankAndFilter(
  redlines: RedlineSuggestion[],
  depth: ReviewDepth,
): { redlines: RedlineSuggestion[]; hiddenMinorCount: number } {
  const ranked = redlines
    .map((r, i) => ({ r, i }))
    .sort((a, b) => SEVERITY_RANK[a.r.severity ?? "medium"] - SEVERITY_RANK[b.r.severity ?? "medium"] || a.i - b.i)
    .map(({ r }) => r);
  if (depth === "comprehensive") return { redlines: ranked, hiddenMinorCount: 0 };
  const isCosmetic = (r: RedlineSuggestion) => r.nature === "housekeeping" && r.severity === "low" && !r.fromInstruction;
  const kept = ranked.filter((r) => !isCosmetic(r));
  return { redlines: kept, hiddenMinorCount: ranked.length - kept.length };
}

/** Exported for tests: turns a VALIDATED review (see reviewProblem) into the
 *  review response shape. */
export function shapeReview(
  raw: Record<string, unknown>,
  doc: string,
  contractType: string | null,
  userSide: string | null,
  depth: ReviewDepth = "balanced",
): ContractReviewResponse {
  const all = (Array.isArray(raw.redlines) ? raw.redlines : []).map((r) => normalizeRedline(r, doc));
  const { redlines, hiddenMinorCount } = rankAndFilter(all, depth);
  const dealBreakers = redlines.filter((r) => r.isDealBreaker).length;
  const negotiationPriorities = Array.isArray(raw.negotiationPriorities)
    ? (raw.negotiationPriorities as ContractReviewResponse["negotiationPriorities"])
    : [];
  const missingClauses = Array.isArray(raw.missingClauses)
    ? raw.missingClauses.filter((x): x is string => typeof x === "string")
    : [];
  const flags = (Array.isArray(raw.flags) ? raw.flags : [])
    .map(normalizeFlag)
    .filter((f): f is ReviewFlag => f !== null);
  return {
    id: uuid(),
    summary: str(raw.summary),
    overallRisk: str(raw.overallRisk, "yellow"),
    contractType,
    userSide,
    redlines,
    negotiationPriorities,
    missingClauses,
    businessImpactSummary: typeof raw.businessImpactSummary === "string" ? raw.businessImpactSummary : null,
    approvalGate: {
      required: dealBreakers > 0,
      level: null,
      dealBreakerCount: dealBreakers,
      reasons: [],
      summary:
        dealBreakers > 0
          ? `${dealBreakers} deal-breaker issue(s) flagged; sign-off recommended before you send.`
          : "No deal-breakers flagged.",
    },
    flags,
    reviewDepth: depth,
    hiddenMinorCount,
  };
}

export async function communityReviewStream(body: unknown, opts: StreamHandlers): Promise<void> {
  const b = (body ?? {}) as {
    documentText?: string;
    contractType?: string;
    userSide?: string;
    markupLevel?: string;
    paperSide?: string;
    reviewInstructions?: string;
    /** The lawyer's default jurisdiction from Settings (see useReview). */
    dealContext?: { governingLaw?: unknown };
  };
  const doc = b.documentText ?? "";
  const depth = normalizeReviewDepth(b.markupLevel);
  opts.onEvent({ event: "init", data: JSON.stringify({ totalSteps: 1 }) });
  opts.onEvent({ event: "progress", data: JSON.stringify({ stepIndex: 0, label: "Reviewing the contract" }) });
  try {
    const p = contractReviewPrompt(
      doc,
      str(b.contractType),
      str(b.userSide),
      depth,
      b.paperSide,
      b.reviewInstructions,
      str(b.dealContext?.governingLaw),
    );
    const raw = await runJson(p.system, p.user, {
      strict: true,
      maxTokens: reviewMaxTokens(),
      signal: opts.signal,
    });
    const problem = reviewProblem(raw);
    if (problem) throw new IncompleteReviewError(problem);
    const review = shapeReview(raw as Record<string, unknown>, doc, b.contractType ?? null, b.userSide ?? null, depth);
    opts.onEvent({ event: "result", data: JSON.stringify({ type: "result", data: review }) });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    opts.onEvent({ event: "error", data: JSON.stringify({ message: reviewFailureMessage(e) }) });
    return;
  }
  opts.onEvent({ event: "done", data: JSON.stringify({}) });
}

export async function communityDraftFixStream(body: unknown, opts: StreamHandlers): Promise<void> {
  const b = (body ?? {}) as { clauseName?: string; currentLanguage?: string; jurisdiction?: string };
  const current = str(b.currentLanguage);
  opts.onEvent({
    event: "thinking",
    data: JSON.stringify({ step: "draft", message: "Drafting a stronger clause", progress: 0.5 }),
  });
  try {
    // Blank means Australia (see lawName in src/lib/region.ts).
    const p = clauseFixPrompt(str(b.clauseName, "Clause"), current, str(b.jurisdiction));
    // Strict: an unreadable answer must not come back as "no change needed".
    const raw = (await runJson(p.system, p.user, { strict: true, signal: opts.signal })) as Record<string, unknown>;
    if (!isObject(raw) || (typeof raw.proposedLanguage !== "string" && raw.noChangeNeeded !== true)) {
      throw new IncompleteReviewError("no proposed wording");
    }
    const proposed = str(raw.proposedLanguage) || current;
    const redline: RedlineSuggestion = {
      clauseName: str(b.clauseName, "Clause"),
      sectionReference: null,
      currentLanguage: current,
      proposedLanguage: proposed,
      rationale: str(raw.rationale),
      fallbackPosition: typeof raw.fallbackPosition === "string" ? raw.fallbackPosition : null,
      grounding: current ? "verified" : "unverified",
      approvalLevel: null,
      isDealBreaker: false,
      nature: "substantive",
    };
    const noChangeNeeded = raw.noChangeNeeded === true || proposed.trim() === current.trim();
    opts.onEvent({
      event: "result",
      data: JSON.stringify({ type: "result", redline, approvalGate: null, noChangeNeeded }),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    opts.onEvent({
      event: "error",
      data: JSON.stringify({
        message: e instanceof IncompleteAnswerError || e instanceof IncompleteReviewError ? `The stronger clause could not be drafted. ${e.message}` : errorMessage(e),
      }),
    });
    return;
  }
  opts.onEvent({ event: "done", data: JSON.stringify({}) });
}
