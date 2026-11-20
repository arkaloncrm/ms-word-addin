/**
 * Word side of "Draft here" (see src/features/drafthere).
 *
 * 1. readCursor({ mark: true }) reads the paragraph the cursor is in and the
 *    nearest non-empty one above it, and drops hidden bookmarks on them, so the
 *    clause lands in the right place even if the lawyer clicks elsewhere while
 *    the AI is writing.
 * 2. insertDraftHere() writes the clause there as a TRACKED change (tracking is
 *    switched on for the insert and restored after), leaves the new text
 *    selected, and bookmarks it.
 * 3. removeLastDraft() removes ArkLaw's own inserted text inside that bookmark,
 *    only when the passage is exactly as ArkLaw wrote it (never the lawyer's
 *    edits), which is what "Try again" does before writing another version.
 *
 * Hidden bookmarks (names starting "_") do not show in Word's Bookmark list and
 * are removed by clearDraftHereMarks() when the lawyer is done.
 */
import { OfficeError, runWord, serializeTrackChanges } from "./run";
import { noteIn, type CursorParagraphs, type DraftTarget } from "@/features/drafthere/target";
import { checkRetry } from "@/features/drafthere/retry";

const PLACE = "_ArkLawDraftHere";
const NOTE = "_ArkLawDraftNote";
const DRAFTED = "_ArkLawDrafted";

/** Word's search box takes at most 255 characters. */
const MAX_SEARCH = 255;

function isHeadingStyle(styleBuiltIn: string | undefined, style: string | undefined): boolean {
  return /^heading/i.test(styleBuiltIn ?? "") || /^heading/i.test(style ?? "");
}

/** Contract body text is plain: drop the bold/italic/underline a heading would pass on. */
function plain(range: Word.Range | Word.Paragraph): void {
  range.font.bold = false;
  range.font.italic = false;
  range.font.underline = Word.UnderlineType.none;
}

export async function readCursor(opts: { mark?: boolean } = {}): Promise<CursorParagraphs> {
  return runWord(async (context) => {
    const doc = context.document;
    const paras = doc.getSelection().paragraphs;
    paras.load("items");
    await context.sync();
    const first = paras.items[0];
    if (!first) return { current: "", previous: "", isHeadingStyle: false, inTable: false };
    first.load("text,style,styleBuiltIn,tableNestingLevel");

    // Nearest non-empty paragraph above (skip up to 3 blank lines).
    let prev = first.getPreviousOrNullObject();
    prev.load("text,isNullObject");
    await context.sync();
    for (let i = 0; i < 3 && !prev.isNullObject && !prev.text.trim(); i++) {
      prev = prev.getPreviousOrNullObject();
      prev.load("text,isNullObject");
      await context.sync();
    }
    const previous = prev.isNullObject ? "" : prev.text;

    if (opts.mark) {
      first.getRange(Word.RangeLocation.whole).insertBookmark(PLACE);
      if (!prev.isNullObject && noteIn(previous).note) {
        prev.getRange(Word.RangeLocation.whole).insertBookmark(NOTE);
      } else {
        doc.deleteBookmark(NOTE);
      }
      await context.sync();
    }

    return {
      current: first.text,
      previous,
      isHeadingStyle: isHeadingStyle(first.styleBuiltIn as string, first.style),
      inTable: (first.tableNestingLevel ?? 0) > 0,
    };
  });
}

/**
 * Insert the drafted paragraphs at the marked spot as a tracked change, select
 * them, and bookmark them for "Try again".
 */
export async function insertDraftHere(target: DraftTarget, blocks: string[]): Promise<{ noteLeft: boolean }> {
  if (blocks.length === 0) throw new OfficeError("ArkLaw did not return any wording. Press Try again.");
  // A note that was used but is not struck out stays in the contract; the panel
  // tells the lawyer to delete it.
  let noteLeft =
    !!target.note && target.placement !== "replace-note" && !target.strikePreviousNote && !target.strikeInlineNote;
  return serializeTrackChanges(() =>
    runWord(async (context) => {
      const doc = context.document;
      doc.load("changeTrackingMode");
      const place = doc.getBookmarkRangeOrNullObject(PLACE);
      place.load("isNullObject");
      await context.sync();
      if (place.isNullObject) {
        throw new OfficeError(
          "ArkLaw lost track of where your cursor was. Put it back on the heading and press Draft here again.",
        );
      }
      const para = place.paragraphs.getFirst();
      para.load("style,styleBuiltIn,isListItem");
      await context.sync();
      const headingStyled = isHeadingStyle(para.styleBuiltIn as string, para.style);
      // Paragraphs ArkLaw creates, checked for list numbering after the insert.
      const created: Word.Paragraph[] = [];

      const priorMode = doc.changeTrackingMode;
      try {
        // Commit the mode flip on its own sync BEFORE inserting, or Word may record
        // the insert as an untracked edit.
        doc.changeTrackingMode = Word.ChangeTrackingMode.trackAll;
        await context.sync();

        const [firstBlock, ...rest] = blocks;
        let firstRange: Word.Range;
        let last: Word.Paragraph = para;
        switch (target.placement) {
          case "same-line":
            firstRange = para.insertText(` ${firstBlock}`, Word.InsertLocation.end);
            break;
          case "fill-empty":
            // Pressing Enter after a numbered heading makes the empty line the
            // next clause number; clause BODY text must not take a number.
            if (para.isListItem) para.detachFromList();
            if (headingStyled) para.styleBuiltIn = Word.BuiltInStyleName.normal;
            firstRange = para.insertText(firstBlock, Word.InsertLocation.start);
            break;
          case "replace-note":
            if (headingStyled) para.styleBuiltIn = Word.BuiltInStyleName.normal;
            firstRange = para.insertText(firstBlock, Word.InsertLocation.replace);
            break;
          case "below":
          default: {
            const p = para.insertParagraph(firstBlock, Word.InsertLocation.after);
            // A Word Heading style would make the clause body a heading too.
            if (headingStyled) p.styleBuiltIn = Word.BuiltInStyleName.normal;
            firstRange = p.getRange(Word.RangeLocation.whole);
            created.push(p);
            last = p;
            break;
          }
        }
        plain(firstRange);

        for (const block of rest) {
          const p = last.insertParagraph(block, Word.InsertLocation.after);
          if (headingStyled) p.styleBuiltIn = Word.BuiltInStyleName.normal;
          plain(p);
          created.push(p);
          last = p;
        }

        // Body paragraphs must never join the heading's numbered list, or every
        // clause after them would renumber. Word does not normally carry list
        // membership across insertParagraph (see lists.ts), but make sure.
        for (const p of created) p.load("isListItem");
        await context.sync();
        for (const p of created) if (p.isListItem) p.detachFromList();

        // Strike out the [Draft: ...] note, as a tracked deletion the lawyer can reject.
        if (target.strikePreviousNote) {
          const note = doc.getBookmarkRangeOrNullObject(NOTE);
          note.load("isNullObject");
          await context.sync();
          if (note.isNullObject) noteLeft = true;
          else note.paragraphs.getFirst().delete();
        }
        if (target.strikeInlineNote) {
          // "^" is special in Word's search even without wildcards; "^^" finds it.
          const query = target.strikeInlineNote.replace(/\^/g, "^^");
          if (query.length > MAX_SEARCH) {
            noteLeft = true;
          } else {
            const hits = para.search(query, { matchCase: false });
            hits.load("items");
            await context.sync();
            if (hits.items[0]) hits.items[0].delete();
            else noteLeft = true;
          }
        }

        const drafted = rest.length
          ? firstRange.expandTo(last.getRange(Word.RangeLocation.end))
          : firstRange;
        drafted.insertBookmark(DRAFTED);
        drafted.select();
        await context.sync();
        return { noteLeft };
      } finally {
        // Best-effort restore so a broken context can't mask the original error.
        try {
          doc.changeTrackingMode = priorMode;
          await context.sync();
        } catch {
          // original error (if any) propagates
        }
      }
    }),
  );
}

/**
 * Remove the last drafted version, but only if the passage is still exactly as
 * ArkLaw wrote it (see checkRetry). Returns "gone" when there is nothing left to
 * reject (the lawyer accepted or deleted it) and "edited" when the lawyer has
 * changed it, in which case nothing is touched: Try again never undoes the
 * lawyer's own edits and never adds a second copy.
 */
export async function removeLastDraft(previous: string[], note: string): Promise<"removed" | "gone" | "edited"> {
  return serializeTrackChanges(() =>
    runWord(async (context) => {
      const range = context.document.getBookmarkRangeOrNullObject(DRAFTED);
      range.load("isNullObject");
      await context.sync();
      if (range.isNullObject) return "gone";
      const changes = range.getTrackedChanges();
      changes.load("items/type");
      const current = range.getReviewedText(Word.ChangeTrackingVersion.current);
      const original = range.getReviewedText(Word.ChangeTrackingVersion.original);
      await context.sync();
      const added = changes.items.filter((c) => c.type === Word.TrackedChangeType.added);
      const check = checkRetry(
        { current: current.value ?? "", original: original.value ?? "", insertedCount: added.length },
        previous,
        note,
      );
      if (check !== "reject") return check;

      // Remove only the inserted text INSIDE the passage. A tracked change can run
      // past the passage (Word merges the same author's adjacent typing into one
      // change), so never reject a whole change. Struck-out text is left alone.
      const parts = added.map((c) => c.getRange().intersectWithOrNullObject(range));
      for (const p of parts) p.load("isNullObject");
      const doc = context.document;
      doc.load("changeTrackingMode");
      await context.sync();
      const priorMode = doc.changeTrackingMode;
      try {
        // Tracking off, so removing ArkLaw's own insertion leaves no deletion mark.
        doc.changeTrackingMode = Word.ChangeTrackingMode.off;
        await context.sync();
        for (const p of parts) if (!p.isNullObject) p.delete();
        await context.sync();
      } finally {
        try {
          doc.changeTrackingMode = priorMode;
          await context.sync();
        } catch {
          // original error (if any) propagates
        }
      }
      return "removed";
    }),
  );
}

/** Remove the hidden bookmarks once the lawyer is finished. Best effort. */
export async function clearDraftHereMarks(): Promise<void> {
  try {
    await runWord(async (context) => {
      for (const name of [PLACE, NOTE, DRAFTED]) context.document.deleteBookmark(name);
      await context.sync();
    });
  } catch {
    // Nothing to clean, or an older Word: the hidden bookmarks are harmless.
  }
}
