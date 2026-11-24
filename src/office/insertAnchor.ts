/**
 * Where a NEW clause goes.
 *
 * An edit that adds wording has no existing text to replace, so it carries a
 * placement instead: `insertAfter` (verbatim words from the end of the paragraph
 * the new wording follows) and `insertAfterClause` (that clause's number, e.g.
 * "2.2"). The new wording lands after that paragraph, never at the cursor.
 *
 * Lookup order:
 *  1. The verbatim text, in the main body only. Exactly one match, or it is not
 *     trusted (duplicated boilerplate would put the clause in the wrong place).
 *  2. The clause number, read from Word's own list numbering or from a number
 *     typed at the start of the paragraph. This does not depend on matching
 *     text, so it still works on a document full of pending tracked changes,
 *     where a verbatim search can miss. The anchor is the LAST paragraph of
 *     that clause (its sub-paragraphs included), so "after 2.2" lands after
 *     2.2(b), not between 2.2 and 2.2(a).
 * If neither finds it, the caller does not insert (see PlacementNotFoundError).
 */
import { findRanges, stripLeadingEnumerator } from "./search";
import { normalizeClauseNumber, typedDepth, typedNumberOf } from "@/lib/placement";

export interface InsertPlacement {
  insertAfter?: string | null;
  insertAfterClause?: string | null;
}

/** A located insertion point. `anchor` is the paragraph the new wording follows;
 *  `levelSource` is the numbered paragraph whose list level a new clause joins
 *  (the clause itself, not its last sub-paragraph). */
export interface LocatedAnchor {
  anchor: Word.Paragraph;
  levelSource: Word.Paragraph;
  /** How it was found, for the card's message. */
  via: "text" | "number";
}

/** True when an edit says where its new wording goes. */
export function hasPlacement(p: InsertPlacement): boolean {
  return !!(p.insertAfter?.trim() || p.insertAfterClause?.trim());
}

/** Trim the anchor text to a searchable tail: its last line, and at most ~200
 *  characters cut at a word boundary (Word's search caps at 255). A clause
 *  number the model copied in front is removed, since Word's automatic numbers
 *  are not searchable text. */
export function anchorNeedle(text: string): string {
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let t = lines[lines.length - 1] ?? "";
  t = stripLeadingEnumerator(t) || t;
  if (t.length <= 200) return t;
  const slice = t.slice(t.length - 200);
  const sp = slice.indexOf(" ");
  return sp >= 0 && sp < 60 ? slice.slice(sp + 1) : slice;
}

/** Locate by the verbatim end-of-paragraph text. Unique body match only. */
async function byText(context: Word.RequestContext, text: string): Promise<LocatedAnchor | null> {
  const needle = anchorNeedle(text);
  if (needle.length < 8) return null;
  const ranges = await findRanges(context, needle, { bodyOnly: true });
  if (ranges.length !== 1) return null;
  const para = ranges[0]!.paragraphs.getLast();
  return { anchor: para, levelSource: para, via: "text" };
}

interface ParaInfo {
  text: string;
  inTable: boolean;
  listNum: string;
  listLevel: number | null;
  heading: boolean;
}

const HEADING_STYLES = /^(heading\d|title)$/i;

/** Locate by clause number, extending to the end of that clause. */
async function byNumber(context: Word.RequestContext, rawNum: string): Promise<LocatedAnchor | null> {
  const target = normalizeClauseNumber(rawNum);
  if (!target) return null;

  const paras = context.document.body.paragraphs;
  paras.load(
    "text,tableNestingLevel,styleBuiltIn," +
      "listItemOrNullObject/isNullObject,listItemOrNullObject/listString,listItemOrNullObject/level",
  );
  await context.sync();

  const info: ParaInfo[] = paras.items.map((p) => {
    const li = p.listItemOrNullObject;
    const isList = !li.isNullObject;
    return {
      text: p.text ?? "",
      inTable: (p.tableNestingLevel ?? 0) > 0,
      listNum: isList ? normalizeClauseNumber(li.listString) : "",
      listLevel: isList ? (li.level ?? 0) : null,
      heading: HEADING_STYLES.test(String(p.styleBuiltIn ?? "")),
    };
  });

  const numberOf = (p: ParaInfo) => p.listNum || typedNumberOf(p.text);
  const hits = info
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !p.inTable && numberOf(p) === target);
  // "(a)" recurs under every clause, so an ambiguous number is not trusted.
  if (hits.length !== 1) return null;
  const start = hits[0]!.i;
  const startInfo = info[start]!;

  // Is paragraph `q` the start of a clause at the same or a higher level?
  const endsClause = (q: ParaInfo): boolean => {
    if (q.inTable || q.heading) return true;
    if (startInfo.listLevel !== null && q.listLevel !== null) return q.listLevel <= startInfo.listLevel;
    const qNum = numberOf(q);
    if (!qNum) return false;
    if (startInfo.listLevel === null && q.listLevel === null) return typedDepth(qNum) <= typedDepth(target);
    // Mixed (one typed, one automatic): fall back to comparing depths.
    const qDepth = q.listLevel ?? typedDepth(qNum);
    const sDepth = startInfo.listLevel ?? typedDepth(target);
    return qDepth <= sDepth;
  };

  let last = start;
  for (let j = start + 1; j < info.length && j <= start + 80; j++) {
    const q = info[j]!;
    if (endsClause(q)) break;
    if (q.text.trim()) last = j;
  }
  return { anchor: paras.items[last]!, levelSource: paras.items[start]!, via: "number" };
}

/**
 * Find where a new clause goes. Returns null when it cannot be placed with
 * confidence; the caller must then NOT insert (no silent cursor fallback).
 * Call inside a Word.run.
 */
export async function locateInsertionAnchor(
  context: Word.RequestContext,
  placement: InsertPlacement,
): Promise<LocatedAnchor | null> {
  const text = placement.insertAfter?.trim();
  if (text) {
    const hit = await byText(context, text);
    if (hit) return hit;
  }
  const num = placement.insertAfterClause?.trim();
  if (num) {
    const hit = await byNumber(context, num);
    if (hit) return hit;
  }
  return null;
}

/** One line for a card: where this new wording will go ("after clause 2.2,
 *  the paragraph ending: ...without notice."). No wrapping quotes, since the
 *  quoted contract text often starts with a quote mark of its own. */
export function describePlacement(p: InsertPlacement): string {
  const num = normalizeClauseNumber(p.insertAfterClause);
  const text = p.insertAfter?.trim();
  if (num && text) return `after clause ${num}, the paragraph ending: ${shortTail(text)}`;
  if (num) return `after clause ${num}`;
  if (text) return `after the paragraph ending: ${shortTail(text)}`;
  return "";
}

function shortTail(text: string): string {
  const t = anchorNeedle(text);
  if (t.length <= 60) return t;
  const slice = t.slice(t.length - 60);
  const sp = slice.indexOf(" ");
  return `...${sp >= 0 ? slice.slice(sp + 1) : slice}`;
}
