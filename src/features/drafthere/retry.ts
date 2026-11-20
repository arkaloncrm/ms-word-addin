/**
 * "Try again" safety check, pure so it is tested without Word.
 *
 * Try again removes ArkLaw's last version before writing another. It must never
 * undo the lawyer's own work, so it compares the WHOLE drafted passage rather
 * than guessing which tracked change is whose (every change carries the
 * lawyer's own Word name, ArkLaw's included):
 *  - "current": the passage as it reads now (all changes accepted) must be
 *    exactly the paragraphs ArkLaw wrote, in order. Any word the lawyer typed or
 *    deleted, or a paragraph they split, changes this and stops Try again.
 *  - "original": the passage with all changes rejected must be empty, or just
 *    the [Draft: ...] note ArkLaw struck out. Anything else (for example a
 *    paragraph the lawyer already accepted) stops Try again.
 * Only on "reject" does src/office/draftHere.ts remove anything, and then only
 * the inserted text INSIDE the passage, never a whole tracked change: Word can
 * merge text the lawyer types next to the passage into ArkLaw's change.
 *
 * By design, blank lines and spacing inside the passage are not compared: they
 * carry no wording, and go with the passage the lawyer asked to replace.
 */

export interface PassageState {
  /** The passage's text with all tracked changes accepted (Word's "current"). */
  current: string;
  /** The passage's text with all tracked changes rejected (Word's "original"). */
  original: string;
  /** How many tracked INSERTIONS sit in the passage. */
  insertedCount: number;
}

export type RetryCheck = "reject" | "gone" | "edited";

/** Word separates paragraphs with \r, line breaks with \v, cells with \u0007. */
function paragraphs(text: string): string[] {
  return text
    .split(/[\r\n\v\u0007]+/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function sameParagraphs(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((p, i) => p === b[i]);
}

function isOnlyTheNote(original: string, note: string): boolean {
  const o = original.replace(/\s+/g, " ").trim();
  if (!o) return true;
  const words = note.replace(/\s+/g, " ").trim();
  if (!words) return false;
  const m = /^\[\s*draft\s*:\s*([^\]]*?)\s*\]$/i.exec(o);
  return !!m && m[1].replace(/\s+/g, " ").trim() === words;
}

export function checkRetry(state: PassageState, previous: string[], note: string): RetryCheck {
  if (state.insertedCount === 0) return "gone";
  const ours = previous.map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!sameParagraphs(paragraphs(state.current), ours)) return "edited";
  if (!isOnlyTheNote(state.original, note)) return "edited";
  return "reject";
}
