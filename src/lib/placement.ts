/**
 * Pure helpers for where NEW wording goes (see src/office/insertAnchor.ts for
 * the Word side). Kept free of Office.js so they are unit-testable.
 */

/**
 * Pull the clause number out of free text: "2.2" from "clause 2.2", "2.2.",
 * "after 2.2 (Supply)"; "(a)" from "(a)". Returns "" when there is none.
 */
export function normalizeClauseNumber(raw: string | null | undefined): string {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return "";
  const dotted = s.match(/(\d+(?:\.\d+)*)/);
  if (dotted) return dotted[1] ?? "";
  const paren = s.match(/\(([a-z]{1,4}|\d{1,3})\)/);
  return paren ? `(${paren[1]})` : "";
}

/** A number typed at the very start of a paragraph ("2.2 The Supplier..."),
 *  normalized like normalizeClauseNumber, or "" when the text does not start
 *  with one. */
export function typedNumberOf(text: string): string {
  const m = text.match(/^\s*(?:(\d+(?:\.\d+)*)\.?|\(([a-z]{1,4}|\d{1,3})\))(?=\s|$)/i);
  if (!m) return "";
  return m[1] ? m[1] : `(${(m[2] ?? "").toLowerCase()})`;
}

/** Outline depth of a typed number: "3" is 0, "2.2" is 1, "(a)" sits below any
 *  dotted number. */
export function typedDepth(num: string): number {
  if (!num) return Number.POSITIVE_INFINITY;
  if (num.startsWith("(")) return 10;
  return num.split(".").length - 1;
}

/** Leading clause number ("9.1 ", "(a) ", "Clause 4. ") removed, or "" when the
 *  text does not start with one. Mirrors stripLeadingEnumerator in office/search. */
export function withoutNumber(s: string): string {
  const stripped = s.replace(
    /^\s*(?:section|article|clause)?\s*(?:\d+(?:\.\d+)*\.?|\([a-z0-9]{1,4}\)|[a-z]{1,2}[.)]|[ivxlcdm]+[.)])\s+/i,
    "",
  );
  return stripped !== s ? stripped.trim() : "";
}

/**
 * Ground a model-proposed placement against the text the model was shown. A
 * verbatim `insertAfter` is kept (minus any clause number copied in front, since
 * Word's automatic numbers are not searchable text); one that is not in the
 * document is dropped rather than searched for. The clause number is kept in
 * normalized form. Either can end up null; the card then offers Copy / Show me
 * where / Insert at cursor instead of guessing.
 */
export function groundPlacement(
  raw: { insertAfter?: unknown; insertAfterClause?: unknown },
  documentText: string,
): { insertAfter: string | null; insertAfterClause: string | null } {
  const after = typeof raw.insertAfter === "string" ? raw.insertAfter.trim() : "";
  const bare = after ? withoutNumber(after) || after : "";
  const inDoc = !!bare && (documentText.includes(after) || documentText.includes(bare));
  const num = normalizeClauseNumber(typeof raw.insertAfterClause === "string" ? raw.insertAfterClause : "");
  return { insertAfter: inDoc ? bare : null, insertAfterClause: num || null };
}
