import type { ReviewDepth } from "@/api/types";
import type { ReviewCoverage } from "./useReview";

export const DEPTH_LABEL: Record<ReviewDepth, string> = {
  critical: "Critical",
  balanced: "Balanced",
  comprehensive: "Comprehensive",
};

/** "about 40,600 words": rounded so it reads as the approximate count it is,
 *  but close enough to check against Word's own word count (status bar). */
function aboutWords(words: number): string {
  const rounded = words >= 1_000 ? Math.round(words / 100) * 100 : words >= 100 ? Math.round(words / 10) * 10 : words;
  return `about ${rounded.toLocaleString("en-AU")} word${rounded === 1 ? "" : "s"}`;
}

/**
 * One line saying exactly what this review covered and in which mode, so the
 * scope is never assumed (a whole document read in one go, a long document
 * read in parts, or only the lawyer's selection). Uses a word count, not
 * pages: page counts depend on fonts and spacing (a 71-page Word document read
 * as "about 84 pages" in the 21 Nov test), while the word count can be checked
 * against Word's status bar.
 */
export function reviewScopeText(scope: ReviewCoverage | null, depth?: ReviewDepth): string {
  const parts: string[] = [];
  if (scope) {
    const words = aboutWords(scope.words);
    if (scope.kind === "selection") {
      parts.push(`your selection only (${words})`);
    } else if (scope.parts > 1) {
      parts.push(`the whole document (${words}), in ${scope.parts} parts`);
    } else {
      parts.push(`the whole document (${words})`);
    }
  }
  if (depth) parts.push(`${DEPTH_LABEL[depth]} mode`);
  return parts.length ? `Reviewed: ${parts.join(" · ")}` : "";
}
