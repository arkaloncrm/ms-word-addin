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
}) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ tone: "info" | "warn"; text: string; failed: string[] } | null>(null);

  const pending = redlines.filter((r) => decisionOf(r) === "pending");
  const applicable = pending.filter(canAutoApply);
  const unplaced = pending.filter((r) => r.grounding === "insertion" && !canAutoApply(r)).length;

  if (applicable.length < 2 && !progress && !result) return null;

  async function run() {
    if (applyBusy || applicable.length === 0) return;
    const batch = applicable.slice();
    setApplyBusy(true);
    setResult(null);
    onErrors({});
    setProgress({ done: 0, total: batch.length });
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
            await applySuggestion(r);
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
        setProgress({ done, total: batch.length });
      }
    } finally {
      setProgress(null);
      setApplyBusy(false);
    }
    onErrors(errors);
    const total = batch.length;
    const base =
      failed.length === 0
        ? `Applied ${applied} change${applied === 1 ? "" : "s"}, each as its own tracked change.`
        : `Applied ${applied} of ${total}. ${failed.length} did not go in:`;
    const extra =
      (skipped > 0 ? ` ${skipped} skipped (resolved while applying).` : "") +
      (unplaced > 0
        ? ` ${unplaced} new clause${unplaced === 1 ? " has" : "s have"} no placement; use Insert at cursor on ${unplaced === 1 ? "that card" : "those cards"}.`
        : "");
    setResult({ tone: failed.length ? "warn" : "info", text: base + extra, failed });
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      {applicable.length >= 2 && (
        <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void run()}
            loading={!!progress}
            disabled={applyBusy && !progress}
            title="Apply every open change as its own tracked change, from the bottom of the document up"
          >
            <CheckIcon size={14} /> Apply all ({applicable.length})
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
