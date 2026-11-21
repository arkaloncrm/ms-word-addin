import type { Grounding, RedlineSuggestion } from "@/api/types";

/**
 * How many times `needle` occurs in `haystack` (overlapping matches counted),
 * stopping early once `stopAt` is reached.
 */
function countOccurrences(haystack: string, needle: string, stopAt = 3): number {
  if (!needle) return 0;
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1 && n < stopAt; i = haystack.indexOf(needle, i + 1)) n++;
  return n;
}

/**
 * The card's grounding label for a redline (audit finding F07). "verified"
 * means the quoted wording occurs EXACTLY ONCE in the document, so there is no
 * doubt which words the change is about. Wording that is not found word for
 * word, or that occurs more than once, is "unverified" with a reason.
 *
 * This is only the label. Applying a change is protected separately: the apply
 * path (src/office/redline.ts) searches the live document again and refuses
 * when it finds no match or more than one, so a change is never made in the
 * wrong place.
 */
export function groundingFor(currentLanguage: string, doc: string): { grounding: Grounding; groundingNote?: string } {
  if (!currentLanguage) return { grounding: "insertion" };
  const n = countOccurrences(doc, currentLanguage);
  if (n === 1) return { grounding: "verified" };
  if (n === 0) {
    return { grounding: "unverified", groundingNote: "This wording was not found word for word in the document." };
  }
  return {
    grounding: "unverified",
    groundingNote: `This wording appears ${n >= 3 ? "3 or more" : "2"} times in the document, so check which one is meant.`,
  };
}

/** Re-grade every redline against the WHOLE document. A long document is
 *  reviewed in sections, and wording that is unique within its section may
 *  still occur elsewhere in the document. */
export function regradeGrounding(redlines: RedlineSuggestion[], doc: string): RedlineSuggestion[] {
  return redlines.map((r) => {
    if (r.grounding === "insertion" || !r.currentLanguage) return r;
    const g = groundingFor(r.currentLanguage, doc);
    return { ...r, grounding: g.grounding, groundingNote: g.groundingNote };
  });
}
