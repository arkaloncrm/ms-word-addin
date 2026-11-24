import { useState } from "react";
import { Banner, Button, LiveRegion } from "@/ui/primitives";
import { CheckIcon } from "@/ui/icons";
import { orderBottomUp } from "@/office/applyOrder";
import { AnchorNotFoundError } from "@/office/redline";
import { PlacementNotFoundError } from "@/office/richInsert";
import { errorMessage } from "@/api/errors";
import { applySuggestion, canAutoApply, placementOf } from "@/features/review/applySuggestion";
import type { RedlineSuggestion } from "@/api/types";
import type { Decision } from "@/features/review/decisions";

/** A per-card failure from a batch apply, shown on that card. */
export interface CardError {
  message: string;
  unplaced?: boolean;
}

/** A proposed Word comment or reply that Apply all adds after the edits. */
export interface NoteTask {
  key: string;
  label: string;
  /** False when it cannot be added by itself (no place given); skipped. */
  addable: boolean;
  /** Always-current: still waiting for a decision. */
  isPending: () => boolean;
  run: () => Promise<void>;
  markDone: () => void;
}

function failureMessage(e: unknown): CardError {
  if (e instanceof PlacementNotFoundError) return { message: e.message, unplaced: true };
  if (e instanceof AnchorNotFoundError) {
    return { message: "Couldn't find this clause word for word. Nothing was changed." };
  }
  return { message: errorMessage(e) };
}

/**
 * "Apply all" for the Edit flow's cards. Each change goes in as its OWN tracked
 * change (the lawyer can accept or reject each in Word), from the bottom of the
 * document upwards so an earlier edit never disturbs a later one's anchor. Each
 * is re-located immediately before it is applied, and one failure never stops
 * the rest: the result lists what went in and what did not, and each failed
 * card shows why. Rendered only when two or more cards can be applied.
 */
export function EditApplyAll({
  redlines,
  keyOf,
  decisionOf,
  decisionOfLive,
  setDecision,
  applyBusy,
  setApplyBusy,
  onApplied,
  onErrors,
  commentFor,
  notes = [],
}: {
  redlines: RedlineSuggestion[];
  keyOf: (r: RedlineSuggestion) => string;
  decisionOf: (r: RedlineSuggestion) => Decision;
  /** Always-current decision reader, so a card dismissed mid-run is skipped. */
  decisionOfLive: (r: RedlineSuggestion) => Decision;
  setDecision: (r: RedlineSuggestion, d: Decision) => void;
  applyBusy: boolean;
  setApplyBusy: (b: boolean) => void;
  onApplied: () => void;
  onErrors: (errors: Record<string, CardError>) => void;
  /** The margin comment to add with each change ("Explain each change in a
   *  comment bubble"), or null for none. */
  commentFor?: (r: RedlineSuggestion) => string | null;
  /** Proposed comments and replies, added after the edits. */
  notes?: NoteTask[];
}) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ tone: "info" | "warn"; text: string; failed: string[] } | null>(null);

  const pending = redlines.filter((r) => decisionOf(r) === "pending");
  const applicable = pending.filter(canAutoApply);
  const unplaced = pending.filter((r) => r.grounding === "insertion" && !canAutoApply(r)).length;
  const openNotes = notes.filter((n) => n.addable && n.isPending());
  const total = applicable.length + openNotes.length;

  if (total < 2 && !progress && !result) return null;

  async function run() {
    if (applyBusy || total === 0) return;
    const batch = applicable.slice();
    const noteBatch = openNotes.slice();
    const all = batch.length + noteBatch.length;
    setApplyBusy(true);
    setResult(null);
    onErrors({});
    setProgress({ done: 0, total: all });
    const errors: Record<string, CardError> = {};
    const failed: string[] = [];
    let applied = 0;
    let skipped = 0;
    try {
      const order = await orderBottomUp(
        batch.map((r) =>
          r.grounding === "insertion"
            ? { kind: "insert" as const, placement: placementOf(r) }
            : { kind: "replace" as const, query: r.currentLanguage },
        ),
      );
      let done = 0;
      for (const k of order) {
        const r = batch[k]!;
        if (decisionOfLive(r) !== "pending") {
          skipped += 1;
        } else {
          try {
            await applySuggestion(r, { comment: commentFor?.(r) ?? null });
            setDecision(r, "accepted");
            applied += 1;
            onApplied();
          } catch (e) {
            const err = failureMessage(e);
            errors[keyOf(r)] = err;
            failed.push(`${r.clauseName}: ${err.message}`);
          }
        }
        done += 1;
        setProgress({ done, total: all });
      }
      // Comments and replies after the edits, so a comment's anchor text is
      // looked up in the document as it now reads.
      for (const n of noteBatch) {
        if (!n.isPending()) {
          skipped += 1;
        } else {
          try {
            await n.run();
            n.markDone();
            applied += 1;
          } catch (e) {
            const message = errorMessage(e);
            errors[n.key] = { message };
            failed.push(`${n.label}: ${message}`);
          }
        }
        done += 1;
        setProgress({ done, total: all });
      }
    } finally {
      setProgress(null);
      setApplyBusy(false);
    }
    onErrors(errors);
    const base =
      failed.length === 0
        ? noteBatch.length === 0
          ? `Applied ${applied} change${applied === 1 ? "" : "s"}, each as its own tracked change.`
          : `Done: ${applied} item${applied === 1 ? "" : "s"} applied. Each change is its own tracked change.`
        : `Applied ${applied} of ${all}. ${failed.length} did not go in:`;
    const extra =
      (skipped > 0 ? ` ${skipped} skipped (resolved while applying).` : "") +
      (unplaced > 0
        ? ` ${unplaced} new clause${unplaced === 1 ? " has" : "s have"} no placement; use Insert at cursor on ${unplaced === 1 ? "that card" : "those cards"}.`
        : "");
    setResult({ tone: failed.length ? "warn" : "info", text: base + extra, failed });
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      {total >= 2 && (
        <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void run()}
            loading={!!progress}
            disabled={applyBusy && !progress}
            title="Apply every open change as its own tracked change, from the bottom of the document up"
          >
            <CheckIcon size={14} /> Apply all ({total})
          </Button>
          {progress && (
            <LiveRegion>
              <span className="small muted">
                Applying {Math.min(progress.done + 1, progress.total)} of {progress.total}...
              </span>
            </LiveRegion>
          )}
        </div>
      )}
      {result && (
        <LiveRegion>
          <Banner tone={result.tone}>
            <p className="small" style={{ margin: 0 }}>
              {result.text}
            </p>
            {result.failed.length > 0 && (
              <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {result.failed.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            )}
          </Banner>
        </LiveRegion>
      )}
    </div>
  );
}
