/**
 * Quoted contract wording in an AI answer becomes a link that jumps to that
 * wording in the open Word document, so the lawyer can check every point at
 * its source without searching.
 *
 * Only passages qualify. A quoted defined term ("Confidential Information") or a
 * single word is a label, not a passage, and stays plain text.
 */
export const MIN_DOC_QUOTE_CHARS = 12;
export const MAX_DOC_QUOTE_CHARS = 600;
const MIN_DOC_QUOTE_WORDS = 3;

export function isDocQuote(text: string): boolean {
  const t = text.trim();
  if (t.length < MIN_DOC_QUOTE_CHARS || t.length > MAX_DOC_QUOTE_CHARS) return false;
  if (/^https?:\/\//i.test(t)) return false;
  return t.split(/\s+/).length >= MIN_DOC_QUOTE_WORDS;
}
