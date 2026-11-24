/**
 * Order a batch of edits from the BOTTOM of the document upwards.
 *
 * Applying from the end first means an earlier (higher) edit never shifts or
 * rewrites the text a later one is anchored on. Each edit is still re-located
 * immediately before it is applied (see applySuggestion), so this ordering is a
 * best effort: an edit that cannot be located here keeps its place at the end
 * of the order and fails (or succeeds) on its own when applied.
 */
import { runWord } from "./run";
import { findRanges } from "./search";
import { locateInsertionAnchor, type InsertPlacement } from "./insertAnchor";

export type ApplyTarget =
  | { kind: "replace"; query: string }
  | { kind: "insert"; placement: InsertPlacement };

/** Relations that put range A after range B (A's end point vs B's end point). */
const AFTER = new Set<string>(["After", "AdjacentAfter"]);

/**
 * Sort keys from a pairwise "is i after j" matrix: the number of other
 * positions each one is after. Exported for tests.
 */
export function rankFromAfterMatrix(after: boolean[][]): number[] {
  return after.map((row) => row.filter(Boolean).length);
}

/**
 * Indices of `targets` in bottom-up application order. Located targets come
 * first, from the end of the document backwards (ties: insertions before
 * replacements, since an insertion goes AFTER its paragraph); unlocated targets
 * follow in their original order. Never throws: on any failure it returns the
 * original order reversed, the best guess for a list written top-down.
 */
export async function orderBottomUp(targets: readonly ApplyTarget[]): Promise<number[]> {
  const fallback = targets.map((_, i) => i).reverse();
  if (targets.length < 2) return targets.map((_, i) => i);
  try {
    return await runWord(async (context) => {
      // One end-point per target: where its change finishes in the document.
      const points: (Word.Range | null)[] = [];
      for (const t of targets) {
        if (t.kind === "replace") {
          const ranges = t.query.trim() ? await findRanges(context, t.query) : [];
          points.push(ranges.length === 1 ? ranges[0]!.getRange(Word.RangeLocation.end) : null);
        } else {
          const hit = await locateInsertionAnchor(context, t.placement);
          points.push(hit ? hit.anchor.getRange(Word.RangeLocation.end) : null);
        }
      }

      const located = points.map((p, i) => ({ p, i })).filter((x) => x.p !== null);
      const rel: (OfficeExtension.ClientResult<Word.LocationRelation> | null)[][] = located.map((a) =>
        located.map((b) => (a.i === b.i ? null : a.p!.compareLocationWith(b.p!))),
      );
      await context.sync();

      const after = rel.map((row) => row.map((r) => (r ? AFTER.has(String(r.value)) : false)));
      const rank = rankFromAfterMatrix(after);
      const order = located
        .map((x, k) => ({ i: x.i, rank: rank[k]!, insert: targets[x.i]!.kind === "insert" }))
        .sort((a, b) => b.rank - a.rank || Number(b.insert) - Number(a.insert) || b.i - a.i)
        .map((x) => x.i);
      const unlocated = points.map((p, i) => (p ? -1 : i)).filter((i) => i >= 0);
      return [...order, ...unlocated];
    });
  } catch {
    return fallback;
  }
}
