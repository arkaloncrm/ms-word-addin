import { describe, expect, it } from "vitest";
import { shapeDraftHere } from "./shape";

describe("shapeDraftHere", () => {
  it("splits the clause into paragraphs", () => {
    const r = shapeDraftHere(
      { text: "On termination, the Supplier must:\n\n(a) return all Customer Data; and\n(b) delete any copies.", notes: null },
      "Return of Data",
    );
    expect(r.blocks).toEqual(["On termination, the Supplier must:", "(a) return all Customer Data; and", "(b) delete any copies."]);
    expect(r.notes).toBeNull();
  });

  it("does not repeat the heading the lawyer typed", () => {
    expect(shapeDraftHere({ text: "Return of Data\n\nThe Supplier must..." }, "5.3 Return of Data").blocks).toEqual([
      "The Supplier must...",
    ]);
    expect(shapeDraftHere({ text: "Return of Data. The Supplier must..." }, "Return of Data").blocks).toEqual([
      "The Supplier must...",
    ]);
  });

  it("moves notes to the lawyer out of the contract text", () => {
    const r = shapeDraftHere(
      {
        text: "The Supplier must return all Customer Data within [30] days. [Note: assumed 30 days]\nDrafting note: check clause 9.",
        notes: "Check the notice period.",
      },
      "Return of Data",
    );
    expect(r.blocks).toEqual(["The Supplier must return all Customer Data within [30] days."]);
    expect(r.notes).toBe("Check the notice period. Note: assumed 30 days Drafting note: check clause 9.");
  });

  it("strips markdown", () => {
    expect(shapeDraftHere({ text: "**The Supplier** must:\n- keep records" }, "").blocks).toEqual([
      "The Supplier must:",
      "keep records",
    ]);
    expect(shapeDraftHere({ text: "> The `Supplier` must keep records." }, "").blocks).toEqual([
      "The Supplier must keep records.",
    ]);
  });

  it("keeps blank-line placeholders made of underscores", () => {
    expect(shapeDraftHere({ text: "The fee is $[____] per month." }, "").blocks).toEqual(["The fee is $[____] per month."]);
  });

  it("returns nothing usable as an empty list", () => {
    expect(shapeDraftHere(null, "x")).toEqual({ blocks: [], notes: null });
    expect(shapeDraftHere({ text: "   " }, "x").blocks).toEqual([]);
  });
});
