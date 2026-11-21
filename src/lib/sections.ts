import type {
  ContractReviewResponse,
  NegotiationPriority,
  ReviewApprovalGate,
} from "@/api/types";

/** A line that starts a clause, schedule or part: the best place to start a new
 *  section. Matches "14. Dispute Resolution", "Schedule 2 - Fees", "Part B". */
const HEADING_LINE = /^(\d{1,3}\.?\s+\S|schedule\b|part\s+[a-z0-9]|annexure\b|appendix\b|attachment\b)/i;

/**
 * Split document text into contiguous sections each at most `maxChars`, breaking
 * BETWEEN paragraphs so no clause is cut mid-sentence. Word's structured text
 * (readStructuredDocumentText) has ONE newline between paragraphs, so this
 * splits on every newline, not only on blank lines: splitting only on blank
 * lines treated a whole contract as one paragraph and cut it mid-sentence every
 * `maxChars` characters. Once a section is 80% full it ends early at a clause or
 * schedule heading, so a section usually starts at a heading. A single paragraph
 * larger than the limit is hard-split as a last resort. Order and text are
 * preserved exactly (the sections join back into the original), so a redline's
 * `currentLanguage` still exists verbatim in the full document.
 */
export function splitIntoSections(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  // Keep each newline with the line before it, so joining the sections gives
  // back the original text exactly.
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [text];
  const sections: string[] = [];
  let current = "";

  const flush = () => {
    if (current) sections.push(current);
    current = "";
  };

  for (const line of lines) {
    if (line.length > maxChars) {
      flush();
      for (let i = 0; i < line.length; i += maxChars) sections.push(line.slice(i, i + maxChars));
      continue;
    }
    const full = current.length + line.length > maxChars;
    const goodBreak = current.length >= maxChars * 0.8 && HEADING_LINE.test(line.trimStart());
    if (full || goodBreak) flush();
    current += line;
  }
  flush();

  return sections.length > 0 ? sections : [text.slice(0, maxChars)];
}

const LEVEL_RANK: Record<string, number> = { manager: 1, partner: 2, gc: 3 };
const RISK_RANK: Record<string, number> = { green: 1, yellow: 2, red: 3 };

function mergeGates(parts: ContractReviewResponse[]): ReviewApprovalGate | null | undefined {
  const gates = parts.map((p) => p.approvalGate).filter((g): g is ReviewApprovalGate => !!g);
  if (gates.length === 0) return parts[0]?.approvalGate;

  const required = gates.some((g) => g.required);
  let level: "manager" | "partner" | "gc" | null = null;
  for (const g of gates) {
    if (g.level && (!level || LEVEL_RANK[g.level] > LEVEL_RANK[level])) level = g.level;
  }
  const dealBreakerCount = gates.reduce((s, g) => s + (g.dealBreakerCount || 0), 0);
  const reasons = gates.flatMap((g) => g.reasons ?? []);
  const summary = required
    ? `${level ?? "Sign-off"} sign-off required. ${dealBreakerCount} deal-breaker${dealBreakerCount === 1 ? "" : "s"} across the document.`
    : "No sign-off required.";
  return { required, level, dealBreakerCount, reasons, summary };
}

function mergePriorities(parts: ContractReviewResponse[]): NegotiationPriority[] {
  const byTier = new Map<number, NegotiationPriority>();
  for (const p of parts) {
    for (const np of p.negotiationPriorities ?? []) {
      const existing = byTier.get(np.tier);
      if (existing) {
        existing.items = [...existing.items, ...np.items];
      } else {
        byTier.set(np.tier, { ...np, items: [...np.items] });
      }
    }
  }
  return [...byTier.values()].sort((a, b) => a.tier - b.tier);
}

/**
 * Merge per-section reviews into one result. Redlines and priorities concatenate
 * (sections are disjoint), the gate takes the highest level and summed
 * deal-breakers, and overall risk takes the worst section.
 *
 * `missingClauses` is intentionally cleared: a per-section pass cannot see the
 * whole contract, so "missing" claims would be false positives. The summary says
 * so, so the reviewer knows a whole-document missing-clause check was not done.
 */
export function mergeReviews(parts: ContractReviewResponse[]): ContractReviewResponse {
  const first = parts[0];
  const n = parts.length;

  let overallRisk = first.overallRisk;
  for (const p of parts) {
    if ((RISK_RANK[p.overallRisk] ?? 0) > (RISK_RANK[overallRisk] ?? 0)) overallRisk = p.overallRisk;
  }

  const sectionLines = parts
    .map((p, i) => `Section ${i + 1}: ${p.summary}`)
    .join(" ");
  const summary =
    `This document was too long for a single pass, so it was reviewed in ${n} sections. ` +
    `Missing-clause analysis is skipped in sectioned mode (no single section sees the whole contract). ` +
    sectionLines;

  // Rank across all sections (high, medium, low), keeping document order within
  // each severity, so the most important finding comes first wherever it is.
  const rank = { high: 0, medium: 1, low: 2 } as const;
  const redlines = parts
    .flatMap((p) => p.redlines ?? [])
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank[a.r.severity ?? "medium"] - rank[b.r.severity ?? "medium"] || a.i - b.i)
    .map(({ r }) => r);
  const hidden = parts.reduce((sum, p) => sum + (p.hiddenMinorCount ?? 0), 0);

  return {
    ...first,
    summary,
    overallRisk,
    redlines,
    negotiationPriorities: mergePriorities(parts),
    missingClauses: [],
    approvalGate: mergeGates(parts),
    flags: parts.flatMap((p) => p.flags ?? []),
    hiddenMinorCount: hidden,
  };
}
