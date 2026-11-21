import { COUNTRY_CODE } from "@/lib/region";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  streamContractReview,
  fetchSavedReview,
  MAX_DOCUMENT_CHARS,
  type ReviewProgress,
} from "@/api/contract-review";
import type { ContractReviewRequest, ContractReviewResponse } from "@/api/types";
import {
  readDocumentFingerprint,
  readSelectionText,
  readStructuredDocumentText,
} from "@/office/document";
import { errorMessage } from "@/api/errors";
import { splitIntoSections, mergeReviews } from "@/lib/sections";
import { regradeGrounding } from "@/lib/grounding";
import { resolveClientRulesContext } from "@/lib/activeClient";
import type { ReviewScope } from "./constants";

export type ReviewStatus = "idle" | "reading" | "streaming" | "done" | "error";

// Section size leaves headroom under the hard cap; a document over this many
// sections is refused rather than fanning out into a very large, slow, costly
// run (each section is a separate billed review pass).
const SECTION_CHARS = MAX_DOCUMENT_CHARS - 5_000;
const MAX_SECTIONS = 8;

export interface RunParams {
  contractType: string;
  userSide: string;
  jurisdiction: string;
  scope: ReviewScope;
  playbookId?: string;
  reviewInstructions?: string;
  /** Include footnotes and headers/footers in the whole-document read. */
  includeExtras?: boolean;
  /** Scope this review to a Vaquill AI matter (carried through to saving). */
  matterId?: string;
  /** Review mode (critical / balanced / comprehensive; older light / standard /
   *  firm values are still accepted and mapped). */
  markupLevel?: ContractReviewRequest["markupLevel"];
  /** Whose paper this is (own / counterparty), or undefined if unknown. */
  paperSide?: "own" | "counterparty";
}

export interface ReviewState {
  status: ReviewStatus;
  progress: ReviewProgress | null;
  result: ContractReviewResponse | null;
  error: string | null;
  /** SHA-256 of the reviewed document body, the freshness baseline. */
  docHash: string | null;
  /** Set when a sectioned review finished only some sections (the rest failed),
   * so the completed, billed work is not thrown away. `missing` names each
   * section that was NOT reviewed (its opening words), so the lawyer knows
   * exactly what is uncovered. */
  partial: { done: number; total: number; missing: string[] } | null;
  /** What the finished review covered, shown above the results. Null for a
   *  resumed review whose scope is unknown. */
  scope: ReviewCoverage | null;
}

/** What one finished review covered. */
export interface ReviewCoverage {
  kind: "document" | "selection";
  /** Number of review passes the text was split into (1 = read in one go). */
  parts: number;
  /** Characters of text reviewed. */
  chars: number;
  /** Words reviewed (whitespace-separated), shown to the lawyer. */
  words: number;
}

/** Word count of the reviewed text, comparable to Word's status-bar count. */
export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Message for a review stream that ended without delivering a review. */
export const NO_RESULT_MESSAGE =
  "Review not completed. The review ended without a result. Nothing has been marked as reviewed or clean. Please try again.";

/** Short label for a section of the contract: its first non-empty line,
 *  trimmed, so a partial-review warning can say which text was not reviewed.
 *  Exported for tests. */
export function sectionLabel(text: string, max = 70): string {
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/**
 * Review the sections of a long document one after another. Stops at the first
 * section that fails, keeping the sections already finished (billed work) so
 * the caller can show a PARTIAL review that names what was not reviewed.
 *
 * Fail-safe: `runSection` returns null when a section's stream ended without
 * delivering a review. That counts as a FAILED section, never an empty (clean)
 * one. Exported for tests.
 */
export async function runSections(
  sections: string[],
  runSection: (text: string, index: number) => Promise<ContractReviewResponse | null>,
  isAborted: () => boolean,
): Promise<{ parts: ContractReviewResponse[]; sectionError: Error | null; aborted: boolean }> {
  const parts: ContractReviewResponse[] = [];
  for (let i = 0; i < sections.length; i++) {
    if (isAborted()) return { parts, sectionError: null, aborted: true };
    let result: ContractReviewResponse | null;
    try {
      result = await runSection(sections[i], i);
    } catch (e) {
      if ((e as Error).name === "AbortError" || isAborted()) return { parts, sectionError: null, aborted: true };
      return { parts, sectionError: e as Error, aborted: false };
    }
    if (isAborted()) return { parts, sectionError: null, aborted: true };
    if (!result) return { parts, sectionError: new Error(NO_RESULT_MESSAGE), aborted: false };
    parts.push(result);
  }
  return { parts, sectionError: null, aborted: false };
}

const INITIAL: ReviewState = {
  status: "idle",
  progress: null,
  result: null,
  error: null,
  docHash: null,
  partial: null,
  scope: null,
};

/** State machine for one streamed contract review. */
export function useReview() {
  const [state, setState] = useState<ReviewState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL);
  }, []);

  /** Load a persisted review result directly into the done state (resume). */
  const hydrate = useCallback((result: ContractReviewResponse, docHash?: string) => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({
      status: "done",
      progress: null,
      result,
      error: null,
      docHash: docHash ?? null,
      partial: null,
      scope: null,
    });
  }, []);

  const run = useCallback(async (params: RunParams) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ status: "reading", progress: null, result: null, error: null, docHash: null, partial: null, scope: null });
    // Track the terminal payload so a dropped trailing "done" frame (proxies can
    // buffer and drop it) does not overwrite a finished, billed review with a
    // truncation error. Declared outside try so the catch can see it.
    let delivered: ContractReviewResponse | null = null;
    // The server's analysis id from the init event (single-pass path only). If
    // the stream drops mid-review after the server already finished + saved the
    // review, the catch recovers the saved result by this id instead of failing.
    // Left null on the sectioned path, where one id can't rebuild the merged set.
    let analysisId: string | null = null;
    try {
      const documentText =
        params.scope === "selection"
          ? await readSelectionText()
          : await readStructuredDocumentText({ extras: params.includeExtras });

      if (!documentText.trim()) {
        setState({
          status: "error",
          progress: null,
          result: null,
          docHash: null,
          partial: null,
          scope: null,
          error:
            params.scope === "selection"
              ? "Select the clause or section you want reviewed first."
              : "No readable text found in this document. If it is a scanned image, it needs to be converted to text (OCR) before it can be reviewed.",
        });
        return;
      }

      // Freshness baseline: the SAME whole-body fingerprint the freshness check
      // (readDocumentFingerprint) recomputes later. Hashing the review's own
      // documentText here instead would be readStructuredDocumentText (list
      // numbers / headings / extras) or the selection text, which never equals
      // the plain-body hash the check produces -- so every review falsely read as
      // "document changed" the instant it finished.
      const docHash = await readDocumentFingerprint();
      // Fold the active client's standing rules into the review instructions, so
      // the client's positions are enforced on the first pass, not just triage.
      const clientRules = await resolveClientRulesContext(params.matterId);
      const reviewInstructions =
        [params.reviewInstructions, clientRules].filter(Boolean).join("\n\n") || undefined;
      const base = {
        contractType: params.contractType,
        userSide: params.userSide,
        // Top-level jurisdiction is the country code (AU). The chosen state
        // travels in dealContext.governingLaw; putting a state name in
        // `jurisdiction` 422s (backend pattern ^([A-Z]{2}|INTL)$).
        jurisdiction: COUNTRY_CODE,
        dealContext: params.jurisdiction ? { governingLaw: params.jurisdiction } : undefined,
        playbookId: params.playbookId,
        reviewInstructions,
        matterId: params.matterId || undefined,
        markupLevel: params.markupLevel || undefined,
        paperSide: params.paperSide || undefined,
      };

      setState((s) => ({ ...s, status: "streaming", docHash }));

      // ---- Small enough for a single pass ----
      if (documentText.length <= MAX_DOCUMENT_CHARS) {
        const scope: ReviewCoverage = {
          kind: params.scope === "selection" ? "selection" : "document",
          parts: 1,
          chars: documentText.length,
          words: countWords(documentText),
        };
        await streamContractReview(
          { documentText, ...base },
          {
            signal: controller.signal,
            onInit: (id) => {
              analysisId = id;
            },
            onProgress: (progress) => setState((s) => ({ ...s, progress })),
            onResult: (result) => {
              delivered = result;
              setState((s) => ({ ...s, status: "done", result, progress: null, scope }));
            },
          },
        );
        // The stream ended cleanly but never delivered a review: that is a
        // failure, not an empty (clean) review, and must not spin forever.
        if (!delivered && !controller.signal.aborted) throw new Error(NO_RESULT_MESSAGE);
        return;
      }

      // ---- Too long: review contiguous sections and merge ----
      const sections = splitIntoSections(documentText, SECTION_CHARS);
      if (sections.length > MAX_SECTIONS) {
        setState({
          status: "error",
          progress: null,
          result: null,
          docHash: null,
          partial: null,
          scope: null,
          error:
            "This document is very large. Review it in parts: select a section in Word, then run the review on the selection.",
        });
        return;
      }

      const outcome = await runSections(sections, async (text, i) => {
        setState((s) => ({
          ...s,
          progress: { step: i + 1, total: sections.length, label: `Reviewing section ${i + 1} of ${sections.length}...` },
        }));
        let sectionResult: ContractReviewResponse | null = null;
        try {
          await streamContractReview(
            { documentText: text, ...base },
            {
              signal: controller.signal,
              onProgress: (progress) =>
                setState((s) => ({
                  ...s,
                  progress: {
                    ...progress,
                    label: `Section ${i + 1}/${sections.length}: ${progress.label ?? "reviewing"}`,
                  },
                })),
              onResult: (result) => {
                sectionResult = result;
              },
            },
          );
        } catch (e) {
          // Tolerate a dropped trailing frame if the section result arrived.
          if (!sectionResult) throw e;
        }
        return sectionResult;
      }, () => controller.signal.aborted);
      if (outcome.aborted) return;
      const { parts, sectionError } = outcome;

      // Nothing completed at all: surface the failure.
      if (parts.length === 0) throw sectionError ?? new Error(NO_RESULT_MESSAGE);

      // Wording unique within one section may still occur elsewhere in the
      // document, so re-grade "verified" against the WHOLE text (finding F07).
      const mergedParts = mergeReviews(parts);
      const merged = { ...mergedParts, redlines: regradeGrounding(mergedParts.redlines, documentText) };
      delivered = merged;
      const partial = sectionError
        ? { done: parts.length, total: sections.length, missing: sections.slice(parts.length).map((s) => sectionLabel(s)) }
        : null;
      const scope: ReviewCoverage = {
        kind: params.scope === "selection" ? "selection" : "document",
        parts: sections.length,
        chars: documentText.length,
        words: countWords(documentText),
      };
      setState((s) => ({ ...s, status: "done", result: merged, progress: null, partial, scope }));
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      if (delivered) {
        setState((s) => ({ ...s, status: "done", progress: null, result: delivered, error: null }));
        return;
      }
      // The stream dropped (network stall / half-open socket) before delivering,
      // but on the single-pass path the server may have finished and SAVED the
      // review already (a Deep review can outlast a shaky connection). If we
      // captured the analysis id from the init event, recover the saved result
      // rather than discarding completed, billed work with a "Cannot reach
      // Vaquill" error.
      if (analysisId && !controller.signal.aborted) {
        const recovered = await fetchSavedReview(analysisId);
        if (recovered) {
          setState((s) => ({ ...s, status: "done", progress: null, result: recovered, error: null }));
          return;
        }
      }
      const error = errorMessage(e);
      setState((s) => ({ ...s, status: "error", progress: null, result: null, error }));
    }
  }, []);

  // Abort any in-flight review when the view unmounts (tab switch), so a paid
  // server-side review is not left running with no consumer.
  useEffect(() => () => abortRef.current?.abort(), []);

  return { state, run, reset, hydrate };
}
