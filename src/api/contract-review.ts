import { postStream } from "./sse";
import { request } from "./http";
import { requestBinary } from "./http";
import { ApiError } from "./errors";
import type { ContractParty } from "@/lib/parties";
import type {
  ContractReviewRequest,
  ContractReviewResponse,
  CorrectedContractRequest,
  RedlineSuggestion,
  ReviewApprovalGate,
} from "./types";

const REVIEW_STREAM = "/api/v1/legal-tools/contract-review/stream";
const EXPORT_CORRECTED = "/api/v1/legal-tools/export-corrected";
const CLASSIFY = "/api/v1/legal-tools/contract-review/classify";
const DRAFT_FIX = "/api/v1/legal-tools/contract-review/redline/draft-fix";

/**
 * Auto-detect the contract type from the document so the Review form can pre-fill
 * it instead of asking the user. Fast, cheap, non-streaming. `contractType` is
 * null when nothing clearly fits, so the caller keeps its remembered default.
 * `parties` (the contract's own party names) is sent by the community edition
 * only; it is absent from the hosted backend, so callers must treat it as optional.
 */
export async function classifyContract(
  documentText: string,
): Promise<{ contractType: string | null; confidence: number; parties?: ContractParty[] }> {
  return request(CLASSIFY, { method: "POST", body: { documentText } });
}

/** Hard client-side cap mirrored from the backend ContractReviewRequest. */
export const MAX_DOCUMENT_CHARS = 200_000;

export interface ReviewProgress {
  step: number;
  total?: number;
  label?: string;
}

export interface ReviewStreamHandlers {
  onProgress?: (p: ReviewProgress) => void;
  onResult: (r: ContractReviewResponse) => void;
  /** The server's analysis id, delivered on the `init` event at the START of the
   *  stream. Captured so a stream that drops mid-review (network stall) can
   *  recover the already-saved result by id (see fetchSavedReview). */
  onInit?: (analysisId: string) => void;
  signal?: AbortSignal;
}

function safeParse<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

/** Shown when a stream delivers a "result" that is not a usable review. */
export const INCOMPLETE_RESULT_MESSAGE =
  "Review not completed. The review result was incomplete. Nothing has been marked as reviewed or clean. Please try again.";

/** A review result is usable only if it carries its list of changes (which
 *  may be empty for a genuinely clean, COMPLETED review). Exported for tests. */
export function isReviewResult(d: unknown): d is ContractReviewResponse {
  return !!d && typeof d === "object" && Array.isArray((d as { redlines?: unknown }).redlines);
}

/**
 * The error for a stream "error" event. When the event carries a message it is
 * shown to the lawyer WORD FOR WORD (kind "unknown" makes errorMessage return
 * it as is): the review's own message says what failed and that nothing was
 * marked as reviewed or clean. Without a message, it stays a generic server
 * error. Exported for tests.
 */
export function streamError(data: string, fallback: string): ApiError {
  const message = safeParse<{ message?: string }>(data)?.message?.trim();
  return message ? new ApiError("unknown", 0, message) : new ApiError("server", 0, fallback);
}

/**
 * Stream a contract review. Resolves when the `done` event arrives.
 * Throws ApiError on quota (402), size (413), or transport failures.
 */
export async function streamContractReview(
  req: ContractReviewRequest,
  handlers: ReviewStreamHandlers,
): Promise<void> {
  if (req.documentText.length > MAX_DOCUMENT_CHARS) {
    throw new ApiError(
      "too_large",
      413,
      "This document is too long to review in full. Select a section instead.",
      "document_too_large",
    );
  }

  // The backend legal-tool stream carries the event name inside the JSON as
  // `type`, so sse.ts surfaces it as `event`. Payload shapes (see
  // legal_tools_streaming.py): init `{totalSteps}`, progress
  // `{stepIndex,label,status}`, result `{data: <review>}`, error `{message}`.
  let total: number | undefined;
  await postStream(REVIEW_STREAM, req, {
    signal: handlers.signal,
    onEvent: ({ event, data }) => {
      switch (event) {
        case "init": {
          const p = safeParse<{ totalSteps?: number; analysisId?: string }>(data);
          if (typeof p?.totalSteps === "number") total = p.totalSteps;
          if (p?.analysisId && handlers.onInit) handlers.onInit(p.analysisId);
          break;
        }
        case "progress": {
          const p = safeParse<{ stepIndex?: number; label?: string }>(data);
          if (p && handlers.onProgress) {
            handlers.onProgress({ step: p.stepIndex ?? 0, total, label: p.label });
          }
          break;
        }
        case "result": {
          // The review is nested under `data` (event payload is {type,data}).
          const r = safeParse<{ data?: ContractReviewResponse }>(data);
          // Second line of defence (independent check, 21 Nov 2026): only a
          // result that carries a list of changes is a review. Anything else
          // is an error, never an empty ("clean") review, whichever backend
          // sent it.
          if (!isReviewResult(r?.data)) throw new ApiError("unknown", 0, INCOMPLETE_RESULT_MESSAGE);
          handlers.onResult(r.data);
          break;
        }
        case "error": {
          throw streamError(data, "The review failed.");
        }
        default:
          break; // done, heartbeats
      }
    },
  });
}

/**
 * Fetch a saved contract-review analysis by id, to RECOVER a review whose stream
 * dropped (network stall / half-open socket) AFTER the server had finished and
 * persisted it. The `init` event gives us the id up front, so on a transport
 * error we can pull the completed, saved result instead of discarding the work
 * with a "Cannot reach Vaquill" error. The saved `result` column is the SAME
 * camelCase shape as the streamed result (both are model_dump(by_alias=True)),
 * so it maps straight onto ContractReviewResponse. Returns null if the analysis
 * is missing, still in flight, or holds no usable redline set.
 */
export async function fetchSavedReview(analysisId: string): Promise<ContractReviewResponse | null> {
  try {
    const row = await request<{ result?: ContractReviewResponse | null }>(
      `/api/v1/legal-tools/analyses/${encodeURIComponent(analysisId)}`,
    );
    const result = row?.result ?? null;
    // A row with no redlines array is not a usable recovered review (still
    // running, or a shape we cannot render).
    if (!result || !Array.isArray(result.redlines)) return null;
    return result;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Agentic "Draft a stronger fix" (rung 1 of the agentic review system)
// ---------------------------------------------------------------------------

/** One reasoning phase of the agentic clause fix (plan -> draft -> validate ->
 *  repair -> critique -> gate). `progress` is 0..1 for a progress bar. */
export interface ClauseFixThinkingStep {
  step: string;
  message: string;
  progress: number;
}

/** The final, grounded, approval-gated replacement the loop produced. When
 *  `noChangeNeeded` is true the clause already meets the playbook position and
 *  `redline.proposedLanguage` echoes the current language (do not swap). */
export interface ClauseFixOutcome {
  redline: RedlineSuggestion;
  approvalGate?: ReviewApprovalGate | null;
  noChangeNeeded: boolean;
}

export interface ClauseFixRequest {
  clauseName: string;
  /** Normalized clause-type key; used server-side to pick the playbook position. */
  clauseType: string;
  currentLanguage: string;
  userSide?: string;
  paperSide?: "own" | "counterparty";
  playbookId?: string;
  jurisdiction?: string;
}

export interface ClauseFixHandlers {
  onThinking?: (t: ClauseFixThinkingStep) => void;
  onResult: (r: ClauseFixOutcome) => void;
  signal?: AbortSignal;
}

/**
 * Stream the agentic clause fix for a single flagged clause. Unlike the plain
 * `/drafting/clause/rewrite` refine, this drafts against the full playbook depth
 * and returns a verified, gated RedlineSuggestion. Emits `thinking` per phase and
 * one `result`. Throws ApiError on quota/transport failures. Resolves on `done`.
 */
export async function streamClauseFix(
  req: ClauseFixRequest,
  handlers: ClauseFixHandlers,
): Promise<void> {
  await postStream(DRAFT_FIX, req, {
    signal: handlers.signal,
    onEvent: ({ event, data }) => {
      switch (event) {
        case "thinking": {
          const p = safeParse<{ step?: string; message?: string; progress?: number }>(data);
          if (p && handlers.onThinking) {
            handlers.onThinking({
              step: p.step ?? "",
              message: p.message ?? "",
              progress: typeof p.progress === "number" ? p.progress : 0,
            });
          }
          break;
        }
        case "result": {
          // draft-fix emits a FLAT result payload {type,redline,approvalGate,...},
          // not the {data:<...>} envelope the review stream uses.
          const p = safeParse<{
            redline?: RedlineSuggestion;
            approvalGate?: ReviewApprovalGate | null;
            noChangeNeeded?: boolean;
          }>(data);
          if (p?.redline) {
            handlers.onResult({
              redline: p.redline,
              approvalGate: p.approvalGate ?? null,
              noChangeNeeded: !!p.noChangeNeeded,
            });
          }
          break;
        }
        case "error": {
          throw streamError(data, "The fix could not be drafted.");
        }
        default:
          break; // done, heartbeats
      }
    },
  });
}

/**
 * Request the authoritative tracked-changes .docx for the accepted redlines.
 * The endpoint returns raw .docx bytes, base64-encoded here for Office.js
 * insertFileFromBase64. Authorship is stamped "Vaquill AI Contract Review"
 * server-side, which the in-pane apply path cannot do (Office.js cannot set a
 * tracked-change author).
 */
export async function exportCorrectedDocx(
  req: CorrectedContractRequest,
): Promise<{ base64: string; filename: string }> {
  return requestBinary(EXPORT_CORRECTED, { method: "POST", body: req });
}
