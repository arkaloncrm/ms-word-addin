/**
 * "Draft here": work out what the lawyer wants drafted from where the cursor is.
 * Pure, so every rule is tested without Word.
 *
 * The cursor can be on:
 *  - a clause heading ("Return of Data", "5.3 Return of Data", "Return of Data.")
 *  - a drafting note ("[Draft: encryption at rest, 72-hour breach notice]"),
 *    on its own line, or the line above the heading
 *  - an empty line just below a heading
 * Anything else (a full paragraph of existing text, a table) is refused with a
 * plain reason, so ArkLaw never writes over or into text it was not asked to.
 */

/** What Word reports about the cursor (see src/office/draftHere.ts). */
export interface CursorParagraphs {
  /** Text of the paragraph the cursor is in. */
  current: string;
  /** Text of the nearest non-empty paragraph above it ("" if none). */
  previous: string;
  /** True when the cursor paragraph uses a Word Heading style. */
  isHeadingStyle: boolean;
  /** True when the cursor is inside a table. */
  inTable: boolean;
}

/**
 * Where the drafted text goes:
 *  - same-line:   after a run-in heading ("Return of Data. <text>")
 *  - below:       new paragraphs under the heading
 *  - fill-empty:  into the empty paragraph the cursor is on
 *  - replace-note: in place of a note that is on its own line
 */
export type Placement = "same-line" | "below" | "fill-empty" | "replace-note";

export interface DraftTarget {
  ok: true;
  /** Clause name with numbering and trailing punctuation removed ("" if none). */
  heading: string;
  /** The words inside a [Draft: ...] note ("" if none). */
  note: string;
  placement: Placement;
  /** True when the note sits in the paragraph above the cursor and should be struck out. */
  strikePreviousNote: boolean;
  /** The full bracketed note, when it shares the cursor line with a heading and should be struck out. */
  strikeInlineNote: string;
}

export interface NoTarget {
  ok: false;
  /** One plain sentence saying what to do instead. */
  reason: string;
}

const NOTE_RE = /\[\s*draft\s*:\s*([^\]]+?)\s*\]/i;

// Leading clause numbering: "5", "5.3", "5.3.1.", "(a)", "a.", "iv.", "Clause 5", "Section 5.3".
const NUMBERING_RE = /^(?:(?:clause|section)\s+)?(?:\d+(?:\.\d+)*\.?|\([a-z0-9]{1,4}\)|[a-z]\.|[ivxlc]{1,6}\.)\s+/i;

const MAX_HEADING_CHARS = 120;
const MAX_HEADING_WORDS = 14;

// Words that usually open a sentence of clause text rather than a heading.
const SENTENCE_START =
  /^(?:the|this|that|these|those|each|any|all|if|where|when|whereas|subject|nothing|no|a|an|it|we|you|neither|either|unless|notwithstanding)\b/i;
const MINOR_WORDS = new Set(["of", "and", "the", "to", "for", "in", "on", "a", "an", "or", "by", "with", "at", "from", "as", "under", "per"]);

// Verbs and modals that make a line a sentence ("Payment is due within 30 days").
// Clause headings are noun phrases ("Payment Terms", "Return of Data").
const VERBISH =
  /\b(?:is|are|was|were|be|been|being|shall|must|will|may|might|can|cannot|should|would|could|agrees?|agreed|means|has|have|had|does|do|did|needs?|includes?|including|provided|applies|apply|remains?|survives?|becomes?|owes?|pays?|warrants?|acknowledges?|represents?|terminates?)\b/i;

/** "The Services", "Return of Data": every significant word starts with a capital. */
function isTitleCase(name: string): boolean {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-z]+/, ""))
    .filter((w) => /[A-Za-z]/.test(w) && !MINOR_WORDS.has(w.toLowerCase()));
  return words.length > 0 && words.every((w) => /^[A-Z]/.test(w));
}

/** "5.3 Return of Data." -> "Return of Data". */
export function clauseName(text: string): string {
  return text
    .trim()
    .replace(NUMBERING_RE, "")
    .replace(/[.:\s]+$/, "")
    .trim();
}

/**
 * True when a line reads like a clause heading rather than clause text: short,
 * one sentence at most, and not ending mid-list (";" or ",").
 */
export function isHeadingLike(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > MAX_HEADING_CHARS) return false;
  if (/[;,]$/.test(t)) return false;
  const name = clauseName(t);
  if (!name || !/[A-Za-z]/.test(name)) return false;
  const words = name.split(/\s+/).length;
  if (words > MAX_HEADING_WORDS) return false;
  // A full stop inside the name means a heading followed by clause text
  // ("Return of Data. The Supplier must ..."): that clause is already written.
  const inner = t.replace(NUMBERING_RE, "").replace(/[.:\s]+$/, "");
  if (/[.!?]\s/.test(inner)) return false;
  // A long line ending in a full stop is a sentence, not a heading.
  if (/\.$/.test(t) && words > 8) return false;
  // "The parties agree as follows." / "The Supplier must comply": a short
  // sentence, not a heading. "The Services." (title case) is still a heading.
  if (SENTENCE_START.test(name) && !isTitleCase(name)) return false;
  // "Payment is due within 30 days.": a verb makes it clause text, unless the
  // line is written in title case like a heading.
  if (VERBISH.test(name) && !isTitleCase(name)) return false;
  return true;
}

/** A run-in heading ends in "." or ":" and the clause continues on the same line. */
function isRunIn(text: string, isHeadingStyle: boolean): boolean {
  return !isHeadingStyle && /[.:]$/.test(text.trim());
}

/** The note's words, or "" when the text has no [Draft: ...] note. */
export function noteIn(text: string): { note: string; full: string } {
  const m = NOTE_RE.exec(text);
  return m ? { note: m[1].trim(), full: m[0] } : { note: "", full: "" };
}

/**
 * Decide what to draft and where. `extra` is anything the lawyer typed in the
 * panel; on an empty line it is enough on its own.
 */
export function findDraftTarget(c: CursorParagraphs, extra = ""): DraftTarget | NoTarget {
  if (c.inTable) {
    return { ok: false, reason: "Draft here works outside tables. Put your cursor on a clause heading in the body." };
  }
  const current = c.current.trim();
  const previous = c.previous.trim();
  const base = { ok: true as const, strikePreviousNote: false, strikeInlineNote: "" };

  // 1. A note on the cursor line.
  const here = noteIn(current);
  if (here.note) {
    const rest = current.replace(here.full, "").trim();
    if (!rest) {
      // Note on its own line: the drafted text replaces it. Use the heading above, if any.
      return {
        ...base,
        heading: isHeadingLike(previous) && !noteIn(previous).note ? clauseName(previous) : "",
        note: here.note,
        placement: "replace-note",
      };
    }
    if (isHeadingLike(rest)) {
      // "Data Security [Draft: ...]": keep the heading, strike the note, write below.
      return { ...base, heading: clauseName(rest), note: here.note, placement: "below", strikeInlineNote: here.full };
    }
    return {
      ok: false,
      reason: "Put the [Draft: ...] note on its own line, or on the line with just the clause heading.",
    };
  }

  // 2. An empty line: draft for the heading (or note) just above it.
  if (!current) {
    const above = noteIn(previous);
    if (above.note) {
      return {
        ...base,
        heading: "",
        note: above.note,
        placement: "fill-empty",
        strikePreviousNote: previous === above.full,
      };
    }
    if (isHeadingLike(previous)) {
      return { ...base, heading: clauseName(previous), note: "", placement: "fill-empty" };
    }
    if (extra.trim()) {
      return { ...base, heading: "", note: "", placement: "fill-empty" };
    }
    return {
      ok: false,
      reason: 'Type a clause heading first (for example "Return of Data"), or say what to write in the box below.',
    };
  }

  // 3. A heading on the cursor line, perhaps with a note on the line above.
  if (isHeadingLike(current)) {
    const above = noteIn(previous);
    return {
      ...base,
      heading: clauseName(current),
      note: above.note,
      placement: isRunIn(current, c.isHeadingStyle) ? "same-line" : "below",
      strikePreviousNote: !!above.note && previous === above.full,
    };
  }

  return {
    ok: false,
    reason:
      'Your cursor is in a paragraph that already has text. Put it on a clause heading (for example "Return of Data") or a [Draft: ...] note.',
  };
}

/** One line for the panel saying what will be drafted. */
export function describeTarget(t: DraftTarget): string {
  if (t.heading && t.note) return `"${t.heading}", following your note`;
  if (t.heading) return `"${t.heading}"`;
  if (t.note) return "your [Draft: ...] note";
  return "your instructions below";
}
