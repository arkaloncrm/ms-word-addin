import { describe, expect, it, vi } from "vitest";
import {
  NOTHING_RETURNED,
  runDraftHere,
  TRY_AGAIN_EDITED,
  TRY_AGAIN_GONE,
  whereInserted,
  type DraftHereDeps,
} from "./flow";
import type { CursorParagraphs, DraftTarget } from "./target";

function deps(cursor: Partial<CursorParagraphs>, blocks = ["The Supplier must return all Customer Data."]) {
  const d = {
    readCursor: vi.fn(async () => ({ current: "", previous: "", isHeadingStyle: false, inTable: false, ...cursor })),
    readDocumentText: vi.fn(async () => "Contract text."),
    request: vi.fn(async () => ({ blocks, notes: null })),
    insert: vi.fn(async () => ({ noteLeft: false })),
    removeLast: vi.fn(async (): Promise<"removed" | "gone" | "edited"> => "removed"),
  };
  return d satisfies DraftHereDeps;
}

const TARGET: DraftTarget = {
  ok: true,
  heading: "Data Security",
  note: "encryption",
  placement: "below",
  strikePreviousNote: true,
  strikeInlineNote: "",
};

describe("runDraftHere", () => {
  it("marks the cursor, asks for that clause and inserts it", async () => {
    const d = deps({ current: "5.3 Return of Data" });
    const out = await runDraftHere(d, { instructions: "", jurisdiction: "nsw" });
    expect(out).toMatchObject({ ok: true, noteLeft: false });
    expect(d.readCursor).toHaveBeenCalledWith({ mark: true });
    expect(d.request).toHaveBeenCalledWith(
      expect.objectContaining({ heading: "Return of Data", placement: "below", jurisdiction: "nsw", documentText: "Contract text." }),
    );
    expect(d.insert).toHaveBeenCalledWith(expect.objectContaining({ heading: "Return of Data" }), [
      "The Supplier must return all Customer Data.",
    ]);
  });

  it("reports a note that was left in the document", async () => {
    const d = deps({ current: "Data Security", previous: "Clause text [Draft: encryption]" });
    d.insert.mockResolvedValue({ noteLeft: true });
    expect(await runDraftHere(d, { instructions: "", jurisdiction: "" })).toMatchObject({ ok: true, noteLeft: true });
  });

  it("explains instead of drafting when the cursor is not on a heading or note", async () => {
    const d = deps({ current: "The Supplier must return all Customer Data within 30 days of termination." });
    const out = await runDraftHere(d, { instructions: "", jurisdiction: "" });
    expect(out.ok).toBe(false);
    expect(d.request).not.toHaveBeenCalled();
    expect(d.insert).not.toHaveBeenCalled();
  });

  it("inserts nothing when the AI returns no wording", async () => {
    const d = deps({ current: "Return of Data" }, []);
    expect(await runDraftHere(d, { instructions: "", jurisdiction: "" })).toEqual({ ok: false, message: NOTHING_RETURNED });
    expect(d.insert).not.toHaveBeenCalled();
  });

  it("Try again removes the last version, then asks for a different one at the same spot", async () => {
    const d = deps({});
    const out = await runDraftHere(d, {
      instructions: "",
      jurisdiction: "",
      retry: { target: TARGET, previous: ["Old para 1.", "Old para 2."], noteLeft: false },
    });
    expect(out.ok).toBe(true);
    expect(d.removeLast).toHaveBeenCalledWith(["Old para 1.", "Old para 2."], "encryption");
    expect(d.readCursor).not.toHaveBeenCalled();
    expect(d.request).toHaveBeenCalledWith(expect.objectContaining({ previousAttempt: "Old para 1.\n\nOld para 2." }));
    // The note was struck the first time; it is not struck again.
    expect(d.insert).toHaveBeenCalledWith(expect.objectContaining({ strikePreviousNote: false }), expect.any(Array));
  });

  it("Try again after a replaced note writes at the start of that line, leaving the note struck", async () => {
    const d = deps({});
    const noteTarget: DraftTarget = { ...TARGET, placement: "replace-note", strikePreviousNote: false };
    const out = await runDraftHere(d, {
      instructions: "",
      jurisdiction: "",
      retry: { target: noteTarget, previous: ["Old."], noteLeft: false },
    });
    expect(d.insert).toHaveBeenCalledWith(expect.objectContaining({ placement: "fill-empty" }), expect.any(Array));
    // The panel still says the text went in place of the note.
    expect(out.ok && out.target.placement).toBe("replace-note");
  });

  it("Try again adds no second copy when the last version is already gone", async () => {
    const d = deps({});
    d.removeLast.mockResolvedValue("gone");
    expect(
      await runDraftHere(d, { instructions: "", jurisdiction: "", retry: { target: TARGET, previous: ["a"], noteLeft: false } }),
    ).toEqual({ ok: false, message: TRY_AGAIN_GONE });
    expect(d.request).not.toHaveBeenCalled();
    expect(d.insert).not.toHaveBeenCalled();
  });

  it("Try again leaves the lawyer's edited version alone", async () => {
    const d = deps({});
    d.removeLast.mockResolvedValue("edited");
    expect(
      await runDraftHere(d, { instructions: "", jurisdiction: "", retry: { target: TARGET, previous: ["a"], noteLeft: false } }),
    ).toEqual({ ok: false, message: TRY_AGAIN_EDITED });
    expect(d.insert).not.toHaveBeenCalled();
  });
});

describe("whereInserted", () => {
  it("names the spot in plain words", () => {
    const base = { ok: true as const, heading: "Return of Data", note: "", strikePreviousNote: false, strikeInlineNote: "" };
    expect(whereInserted({ ...base, placement: "same-line" })).toBe('after "Return of Data"');
    expect(whereInserted({ ...base, placement: "below" })).toBe('below "Return of Data"');
    expect(whereInserted({ ...base, placement: "fill-empty" })).toBe("on the empty line");
    expect(whereInserted({ ...base, placement: "replace-note" })).toBe("in place of your note");
  });
});
