/**
 * The "Draft here" sequence, with Word and the AI passed in so the whole flow
 * is tested without either: read the cursor, decide what to draft, ask the AI,
 * insert. "Try again" first removes the last version (only ArkLaw's own
 * insertion, never the lawyer's edits), then asks for a different one at the
 * same spot.
 */
import type { DraftHereRequest } from "@/api/draft-here";
import type { DraftHereResult } from "./shape";
import { findDraftTarget, type CursorParagraphs, type DraftTarget } from "./target";

export interface DraftHereDeps {
  readCursor: (opts: { mark: boolean }) => Promise<CursorParagraphs>;
  readDocumentText: () => Promise<string>;
  request: (body: DraftHereRequest) => Promise<DraftHereResult>;
  insert: (target: DraftTarget, blocks: string[]) => Promise<{ noteLeft: boolean }>;
  removeLast: (previous: string[], note: string) => Promise<"removed" | "gone" | "edited">;
}

export type DraftHereOutcome =
  | { ok: true; target: DraftTarget; result: DraftHereResult; noteLeft: boolean }
  | { ok: false; message: string };

export const TRY_AGAIN_GONE =
  "The last version was already accepted or removed, so Try again would add a second copy. Press Draft here to start again.";
export const TRY_AGAIN_EDITED =
  "You have changed the last version, so ArkLaw has left it alone (it never undoes your own edits). Remove it yourself if you want a fresh one, then press Draft here.";
export const NOTHING_RETURNED = "ArkLaw did not return any wording. Press Draft here again.";

export async function runDraftHere(
  deps: DraftHereDeps,
  input: {
    instructions: string;
    jurisdiction: string;
    /** Set on "Try again": the spot, the version being replaced, and whether the note was left. */
    retry?: { target: DraftTarget; previous: string[]; noteLeft: boolean };
  },
): Promise<DraftHereOutcome> {
  let target: DraftTarget;
  if (input.retry) {
    const removed = await deps.removeLast(input.retry.previous, input.retry.target.note);
    if (removed === "gone") return { ok: false, message: TRY_AGAIN_GONE };
    if (removed === "edited") return { ok: false, message: TRY_AGAIN_EDITED };
    // The note was already struck out the first time; do not strike it twice.
    target = { ...input.retry.target, strikePreviousNote: false, strikeInlineNote: "" };
  } else {
    const found = findDraftTarget(await deps.readCursor({ mark: true }), input.instructions);
    if (!found.ok) return { ok: false, message: found.reason };
    target = found;
  }

  const documentText = await deps.readDocumentText();
  const result = await deps.request({
    documentText,
    heading: target.heading,
    note: target.note,
    instructions: input.instructions,
    placement: target.placement,
    jurisdiction: input.jurisdiction,
    previousAttempt: input.retry ? input.retry.previous.join("\n\n") : undefined,
  });
  if (result.blocks.length === 0) return { ok: false, message: NOTHING_RETURNED };

  // On Try again the struck note stays struck in its paragraph, so the new
  // version goes in at the start of that paragraph rather than replacing it.
  const insertTarget: DraftTarget =
    input.retry && target.placement === "replace-note" ? { ...target, placement: "fill-empty" } : target;
  const inserted = await deps.insert(insertTarget, result.blocks);
  return { ok: true, target, result, noteLeft: input.retry ? input.retry.noteLeft : inserted.noteLeft };
}

/** Where the text went, in the lawyer's words. */
export function whereInserted(t: DraftTarget): string {
  switch (t.placement) {
    case "same-line":
      return `after "${t.heading}"`;
    case "below":
      return t.heading ? `below "${t.heading}"` : "below the heading";
    case "fill-empty":
      return "on the empty line";
    case "replace-note":
      return "in place of your note";
  }
}
