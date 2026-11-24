import { applyVerifiedRedline, canApplyInPane } from "@/office/redline";
import { insertClauseAtAnchor, PlacementNotFoundError } from "@/office/richInsert";
import { hasPlacement, type InsertPlacement } from "@/office/insertAnchor";
import type { RedlineSuggestion } from "@/api/types";

/** The placement an insertion carries (empty for a replacement). */
export function placementOf(r: RedlineSuggestion): InsertPlacement {
  return { insertAfter: r.insertAfter ?? null, insertAfterClause: r.insertAfterClause ?? null };
}

/** True when the card can write this suggestion into the document itself: a
 *  replacement with anchor text, or an insertion that says where it goes. An
 *  insertion without a placement is never dropped at the cursor by default. */
export function canAutoApply(r: RedlineSuggestion): boolean {
  if (r.grounding === "insertion") return hasPlacement(placementOf(r));
  return canApplyInPane(r);
}

/**
 * Write one suggestion into the document as its own tracked change (or clean,
 * with tracked:false). A replacement is located by its verbatim text; an
 * insertion by its placement. Both are re-located inside their own Word.run,
 * immediately before writing, so earlier edits in a batch cannot leave them
 * pointing at a stale position. Throws on failure; inserts nothing when an
 * insertion cannot be placed (PlacementNotFoundError).
 */
export async function applySuggestion(
  r: RedlineSuggestion,
  opts: { proposed?: string; tracked?: boolean } = {},
): Promise<void> {
  const proposed = opts.proposed ?? r.proposedLanguage;
  if (r.grounding === "insertion") {
    if (!hasPlacement(placementOf(r))) throw new PlacementNotFoundError();
    await insertClauseAtAnchor(proposed, placementOf(r), { tracked: opts.tracked });
    return;
  }
  await applyVerifiedRedline({ ...r, proposedLanguage: proposed }, { tracked: opts.tracked });
}
