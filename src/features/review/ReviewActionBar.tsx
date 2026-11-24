import { useState } from "react";
import { Button, Banner, LiveRegion } from "@/ui/primitives";
import { DownloadDocxButton } from "./DownloadDocxButton";
import { isCommunity } from "@/community/edition";
import { exportCorrectedDocx } from "@/api/contract-review";
import { downloadBlob, downloadDocx, readDocumentAsDocxBlob } from "@/office/export";
import { readDocumentText } from "@/office/document";
import { orderBottomUp } from "@/office/applyOrder";
import { applySuggestion, canAutoApply, placementOf } from "./applySuggestion";
import { errorMessage } from "@/api/errors";
import type { RedlineSuggestion, AcceptedRedline } from "@/api/types";
import type { Decision } from "./decisions";

interface ApplyOutcome {
  applied: number;
  failed: number;
  skipped: number;
  total: number;
}

/**
 * Sticky bottom bar. Two clearly separated actions:
 *  - Apply all open verified redlines in place, as tracked changes.
 *  - Download a clean redlined copy generated server-side (authored
 *    "Vaquill AI Contract Review"), for sharing without touching the working doc.
 */
export function ReviewActionBar({
  redlines,
  contractType,
  decisionOf,
  decisionOfLive,
  setDecision,
  applyBusy,
  setApplyBusy,
}: {
  redlines: RedlineSuggestion[];
  contractType: string;
  decisionOf: (i: number) => Decision;
  /** Always-current decision reader (see useDecisions) - use inside the async
   *  loop so a dismissal that lands mid-run is honored. */
  decisionOfLive: (i: number) => Decision;
  setDecision: (i: number, d: Decision) => void;
  /** Shared apply lock (see ReviewView) so this and a per-card Accept cannot run
   *  concurrently. */
  applyBusy: boolean;
  setApplyBusy: (b: boolean) => void;
}) {
  const [applying, setApplying] = useState<{ done: number; total: number } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const openApplicable = redlines
    .map((r, i) => ({ r, i }))
    .filter(({ r, i }) => decisionOf(i) === "pending" && canAutoApply(r));
  // New wording with no placement is never dropped at the cursor in a batch; the
  // card offers Copy / Show me where / Insert at cursor for those instead.
  const unplacedCount = redlines.filter(
    (r, i) => decisionOf(i) === "pending" && r.grounding === "insertion" && !canAutoApply(r),
  ).length;

  // Apply every open, applicable redline in place as tracked changes. Returns a
  // count breakdown, or null if an apply is already running (never run
  // concurrently with a per-card Accept -- a double insertion-redline would
  // append the clause to the document twice). Callers own the messaging.
  async function runApplyAll(): Promise<ApplyOutcome | null> {
    if (applyBusy) return null;
    const total = openApplicable.length;
    setApplyBusy(true);
    setApplying({ done: 0, total });
    let done = 0;
    let failed = 0;
    let skipped = 0;
    try {
      // Bottom of the document first, so an earlier edit never shifts the text a
      // later one is anchored on. Each is still re-located just before it is
      // applied (applySuggestion), and one failure never stops the rest.
      const order = await orderBottomUp(
        openApplicable.map(({ r }) =>
          r.grounding === "insertion"
            ? { kind: "insert" as const, placement: placementOf(r) }
            : { kind: "replace" as const, query: r.currentLanguage },
        ),
      );
      for (const k of order) {
        const { r, i } = openApplicable[k]!;
        // Re-read the LIVE decision: the snapshot was captured at click time, so a
        // redline the reviewer dismissed (or accepted) during this loop must not
        // be written with the stale proposal.
        if (decisionOfLive(i) !== "pending") {
          skipped += 1;
          done += 1;
          setApplying({ done, total });
          continue;
        }
        try {
          await applySuggestion(r);
          setDecision(i, "accepted");
        } catch {
          // Leave this one open; the reviewer handles it individually. This is the
          // ambiguous-anchor / not-found path, so it must be surfaced, not silent.
          failed += 1;
        }
        done += 1;
        setApplying({ done, total });
      }
    } finally {
      setApplying(null);
      setApplyBusy(false);
    }
    return { applied: total - failed - skipped, failed, skipped, total };
  }

  async function applyAll() {
    setError(null);
    setNote(null);
    const r = await runApplyAll();
    if (!r) return;
    const unplacedNote =
      unplacedCount > 0
        ? ` ${unplacedCount} new clause${unplacedCount === 1 ? " has" : "s have"} no placement; use Insert at cursor on ${unplacedCount === 1 ? "that card" : "those cards"}.`
        : "";
    if (r.failed > 0) {
      setError(
        `Applied ${r.applied} of ${r.total}. ${r.failed} could not be placed automatically (the clause text was not found or appears more than once); apply those individually.${unplacedNote}`,
      );
    } else {
      setNote(
        `Applied ${r.applied} redline${r.applied === 1 ? "" : "s"} as tracked changes.` +
          (r.skipped > 0 ? ` ${r.skipped} skipped (resolved while applying).` : "") +
          unplacedNote,
      );
    }
  }

  // Community/BYOK download: no backend, so build the redlined copy on-device.
  // Apply the open redlines as tracked changes, then export the CURRENT document
  // (which now carries them) via getFileAsync and hand it back as a .docx. The
  // tracked changes also remain in the open document, reversible by the user.
  async function downloadLocal() {
    setError(null);
    setNote(null);
    setDownloading(true);
    try {
      const r = await runApplyAll();
      if (!r) return; // an apply is already in flight
      const blob = await readDocumentAsDocxBlob();
      const filename = `redlined-${(contractType || "document").toLowerCase()}.docx`;
      if (!downloadBlob(blob, filename)) {
        setError("Could not start the download in this version of Word.");
        return;
      }
      const appliedMsg =
        r.applied > 0
          ? `Applied ${r.applied} redline${r.applied === 1 ? "" : "s"} as tracked changes and downloaded the redlined copy.`
          : "Downloaded a copy of the document.";
      setNote(
        r.failed > 0
          ? `${appliedMsg} ${r.failed} could not be placed automatically; apply those individually.`
          : appliedMsg,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setDownloading(false);
    }
  }

  async function download() {
    setError(null);
    // Honor the reviewer's decisions: exclude REJECTED redlines (previously
    // every non-insertion redline baked in regardless, silently disagreeing
    // with the "Apply all open" button). Inserted (missing-clause) redlines
    // have no currentLanguage to replace, so they can't go in a corrected
    // export -- excluding them also avoids sending an empty list, which the
    // backend rejects with a 422 (min_length=1).
    const accepted: AcceptedRedline[] = redlines
      .map((r, i) => ({ r, i }))
      .filter(
        ({ r, i }) =>
          r.grounding !== "insertion" && r.currentLanguage.trim() && decisionOf(i) !== "rejected",
      )
      .map(({ r }) => ({
        clauseName: r.clauseName,
        currentLanguage: r.currentLanguage,
        replacementLanguage: r.proposedLanguage,
        comment: r.rationale,
      }));
    if (accepted.length === 0) {
      setError(
        "No replaceable redlines to export. Inserted (missing-clause) suggestions apply in the pane only, and rejected redlines are excluded.",
      );
      return;
    }
    setDownloading(true);
    try {
      const documentText = await readDocumentText();
      const { base64, filename } = await exportCorrectedDocx({
        documentText,
        acceptedRedlines: accepted,
        contractType,
        trackedChanges: true,
      });
      if (!downloadDocx(base64, filename)) {
        setError("Could not start the download in this version of Word.");
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="action-bar">
      {error && <Banner tone="danger">{error}</Banner>}
      {note && (
        <LiveRegion>
          <Banner tone="info">{note}</Banner>
        </LiveRegion>
      )}
      <div className="action-bar__row">
        <Button
          variant="primary"
          block
          onClick={applyAll}
          loading={!!applying}
          disabled={openApplicable.length === 0 || (applyBusy && !applying)}
        >
          {applying
            ? `Applying ${applying.done}/${applying.total}...`
            : openApplicable.length > 0
              ? `Apply all open (${openApplicable.length})`
              : "All addressed"}
        </Button>
        <DownloadDocxButton
          onDownload={isCommunity() ? downloadLocal : download}
          downloading={downloading}
        />
      </div>
    </div>
  );
}
