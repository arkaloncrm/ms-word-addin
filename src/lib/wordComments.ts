/**
 * Word comments, formatted for the AI. Pure, so it is unit-testable; the Word
 * read lives in src/office/comments.ts (readDocumentComments).
 */

export interface CommentReply {
  author: string;
  text: string;
}

export interface DocumentComment {
  id: string;
  author: string;
  text: string;
  resolved: boolean;
  /** The document text the comment is attached to ("" if Word would not say). */
  anchorText: string;
  replies: CommentReply[];
}

/** Result of reading comments: the list, or `failed` when Word could not read
 *  them (so the AI says so instead of claiming there are none). */
export interface CommentsRead {
  comments: DocumentComment[];
  failed: boolean;
}

const MAX_COMMENTS = 150;
const ANCHOR_MAX = 300;
const TEXT_MAX = 1_500;

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}...`;
}

/**
 * The [WORD COMMENTS] block appended after the document text. Always present,
 * so "check my comments" gets a definite answer: the comments, "no comments",
 * or "could not be read".
 */
export function formatCommentsForAi(read: CommentsRead): string {
  if (read.failed) return "[WORD COMMENTS]\nThe comments in this document could not be read in this version of Word.";
  const list = read.comments;
  if (list.length === 0) return "[WORD COMMENTS]\nThis document has no Word comments.";
  const shown = list.slice(0, MAX_COMMENTS);
  const lines = shown.map((c, i) => {
    const state = c.resolved ? "resolved" : "open";
    const on = c.anchorText.trim() ? ` on "${clip(c.anchorText, ANCHOR_MAX)}"` : "";
    const head = `${i + 1}. ${c.author || "Unknown"} (${state})${on}: ${clip(c.text, TEXT_MAX)}`;
    const replies = c.replies.map((r) => `   Reply from ${r.author || "Unknown"}: ${clip(r.text, TEXT_MAX)}`);
    return [head, ...replies].join("\n");
  });
  const more = list.length > shown.length ? `\n(${list.length - shown.length} more comments not shown.)` : "";
  return `[WORD COMMENTS] (${list.length}, in document order)\n${lines.join("\n")}${more}`;
}
