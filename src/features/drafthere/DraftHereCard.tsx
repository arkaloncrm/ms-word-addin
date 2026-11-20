import { useEffect, useRef, useState } from "react";
import { AutoTextarea } from "@/ui/AutoTextarea";
import { Banner, Button, Field, LiveRegion } from "@/ui/primitives";
import { SourceNote } from "@/ui/SourceNote";
import { errorMessage } from "@/api/errors";
import { requestDraftHere } from "@/api/draft-here";
import { getReviewPrefs } from "@/lib/prefs";
import { isWordHost } from "@/office/run";
import { readDocumentText } from "@/office/document";
import { onSelectionChanged } from "@/office/selection";
import { clearDraftHereMarks, insertDraftHere, readCursor, removeLastDraft } from "@/office/draftHere";
import { runDraftHere, whereInserted, type DraftHereDeps } from "./flow";
import { describeTarget, findDraftTarget, type DraftTarget, type NoTarget } from "./target";
import type { DraftHereResult } from "./shape";

const DEPS: DraftHereDeps = {
  readCursor,
  readDocumentText,
  request: requestDraftHere,
  insert: insertDraftHere,
  removeLast: removeLastDraft,
};

type Live = { kind: "no-word" } | { kind: "reading" } | { kind: "found"; target: DraftTarget | NoTarget };

/**
 * What the cursor is on, refreshed as the lawyer moves it, so the card can say
 * "Ready to draft "Return of Data"" before they click. Paused while drafting.
 */
function useCursorTarget(instructions: string, enabled: boolean): Live {
  const [live, setLive] = useState<Live>(() => (isWordHost() ? { kind: "reading" } : { kind: "no-word" }));
  const extra = useRef(instructions);
  extra.current = instructions;

  useEffect(() => {
    if (!enabled || !isWordHost()) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        readCursor({ mark: false })
          .then((c) => alive && setLive({ kind: "found", target: findDraftTarget(c, extra.current) }))
          .catch(() => alive && setLive({ kind: "no-word" }));
      }, 250);
    };
    refresh();
    let off = () => {};
    try {
      off = onSelectionChanged(refresh);
    } catch {
      // No selection events on this host: the first read still shows.
    }
    return () => {
      alive = false;
      clearTimeout(timer);
      off();
    };
  }, [enabled, instructions]);

  return live;
}

/**
 * "Draft here": one click writes the clause for the heading or [Draft: ...] note
 * at the cursor, in the contract's own defined terms, as a tracked change that is
 * left selected. "Try again" swaps in a different version.
 */
export function DraftHereCard() {
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState<null | "draft" | "retry">(null);
  const [done, setDone] = useState<{
    target: DraftTarget;
    result: DraftHereResult;
    noteLeft: boolean;
    version: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useCursorTarget(instructions, !busy && !done);

  async function draft(retry: boolean) {
    setBusy(retry ? "retry" : "draft");
    setError(null);
    try {
      const outcome = await runDraftHere(DEPS, {
        instructions,
        jurisdiction: getReviewPrefs().jurisdiction,
        retry:
          retry && done ? { target: done.target, previous: done.result.blocks, noteLeft: done.noteLeft } : undefined,
      });
      if (outcome.ok) {
        setDone({
          target: outcome.target,
          result: outcome.result,
          noteLeft: outcome.noteLeft,
          version: retry && done ? done.version + 1 : 1,
        });
      } else {
        setError(outcome.message);
        // A failed Try again has already removed the old version (or found it gone).
        if (retry) setDone(null);
      }
    } catch (e) {
      setError(errorMessage(e));
      if (retry) setDone(null);
    } finally {
      setBusy(null);
    }
  }

  function finish() {
    void clearDraftHereMarks();
    setDone(null);
    setError(null);
    setInstructions("");
  }

  if (done) {
    const struck = (done.target.strikePreviousNote || !!done.target.strikeInlineNote) && !done.noteLeft;
    return (
      <div className="card stack draft-here" style={{ padding: 12, gap: 8 }}>
        <strong>Draft here</strong>
        <p className="small" style={{ margin: 0 }}>
          {done.version > 1 ? `Version ${done.version} added ` : "Added "}
          {whereInserted(done.target)} as a tracked change, and selected. Accept or reject it in Word's Review
          tab.
          {struck ? " Your [Draft: ...] note is struck out as a tracked change." : ""}
        </p>
        {done.noteLeft && (
          <Banner tone="warn">Your [Draft: ...] note is still in the document. Delete it when you are happy.</Banner>
        )}
        <SourceNote>
          written by AI from this contract and your {done.target.heading ? "heading" : "note"}, not copied from a
          precedent. Check it before you rely on it.
        </SourceNote>
        {done.result.notes && <Banner tone="warn">Check: {done.result.notes}</Banner>}
        <div className="row" style={{ gap: 8 }}>
          <Button variant="default" size="sm" onClick={() => void draft(true)} loading={busy === "retry"}>
            Try again
          </Button>
          <Button variant="ghost" size="sm" onClick={finish} disabled={!!busy}>
            Done
          </Button>
        </div>
        {error && <Banner tone="danger">{error}</Banner>}
      </div>
    );
  }

  return (
    <div className="card stack draft-here" style={{ padding: 12, gap: 8 }}>
      <div className="stack" style={{ gap: 2 }}>
        <strong>Draft here</strong>
        <span className="small muted">
          Put your cursor on a clause heading (for example "Return of Data") or a [Draft: ...] note. ArkLaw
          writes just that clause, in this contract's defined terms, as a tracked change.
        </span>
      </div>
      <LiveRegion>
        {live.kind === "no-word" ? (
          <span className="small muted">Open a contract in Word to use Draft here.</span>
        ) : live.kind === "found" && live.target.ok ? (
          <span className="small">Ready to draft {describeTarget(live.target)}.</span>
        ) : live.kind === "found" && !live.target.ok ? (
          <span className="small muted">{live.target.reason}</span>
        ) : null}
      </LiveRegion>
      <Field label="Anything to add? (optional)">
        <AutoTextarea
          value={instructions}
          placeholder="e.g. 30 days, and the Supplier must certify destruction in writing"
          onChange={(e) => setInstructions(e.target.value)}
        />
      </Field>
      <Button
        variant="primary"
        onClick={() => void draft(false)}
        loading={busy === "draft"}
        disabled={live.kind === "no-word"}
        style={{ alignSelf: "flex-start" }}
      >
        Draft here
      </Button>
      {busy === "draft" && <span className="small muted">Reading the contract and writing the clause...</span>}
      {error && <Banner tone="danger">{error}</Banner>}
    </div>
  );
}
