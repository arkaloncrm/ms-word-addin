/**
 * Ground the comments (Word margin bubbles) an edit model proposes. Pure, so it
 * is unit-testable; used by the community edit route.
 */
import { withoutNumber } from "./placement";
import type { CommentProposal } from "@/api/edit";

const MAX_COMMENTS = 30;
const MAX_TEXT = 2_000;
const MAX_ANCHOR = 400;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Keep only usable proposals:
 *  - a reply needs a positive whole-number `replyTo` (its anchor is ignored);
 *  - a new comment keeps its anchor only when that wording is in the document
 *    (a clause number copied in front is dropped); an anchor that is not found
 *    becomes "" so the card offers Copy instead of guessing a place;
 *  - empty text is dropped, and long text is capped.
 */
export function groundComments(raw: unknown, documentText: string): CommentProposal[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: CommentProposal[] = [];
  for (const item of list) {
    if (out.length >= MAX_COMMENTS) break;
    const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const text = str(o.text).slice(0, MAX_TEXT);
    if (!text) continue;
    const label = str(o.label) || "Comment";
    const sectionReference = str(o.sectionReference) || null;
    const n = typeof o.replyTo === "number" ? o.replyTo : Number(str(o.replyTo));
    if (Number.isInteger(n) && n >= 1) {
      out.push({ label, sectionReference, anchor: "", text, replyTo: n });
      continue;
    }
    const anchorRaw = str(o.anchor).slice(0, MAX_ANCHOR);
    const bare = anchorRaw ? withoutNumber(anchorRaw) || anchorRaw : "";
    const found = !!bare && (documentText.includes(anchorRaw) || documentText.includes(bare));
    out.push({ label, sectionReference, anchor: found ? bare : "", text, replyTo: null });
  }
  return out;
}
