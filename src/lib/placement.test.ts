import { describe, expect, it } from "vitest";
import { groundPlacement, normalizeClauseNumber, typedDepth, typedNumberOf } from "./placement";

describe("normalizeClauseNumber", () => {
  it.each([
    ["2.2", "2.2"],
    ["clause 2.2", "2.2"],
    ["2.2.", "2.2"],
    ["After 1.4 (Term)", "1.4"],
    ["(a)", "(a)"],
    ["(IV)", "(iv)"],
    ["", ""],
    [null, ""],
    ["Definitions", ""],
  ])("%s -> %s", (raw, want) => {
    expect(normalizeClauseNumber(raw as string | null)).toBe(want);
  });
});

describe("typedNumberOf / typedDepth", () => {
  it("reads a typed number at the start of a paragraph", () => {
    expect(typedNumberOf("2.2 The Supplier may change")).toBe("2.2");
    expect(typedNumberOf("10. Termination")).toBe("10");
    expect(typedNumberOf("(b) any other loss")).toBe("(b)");
    expect(typedNumberOf("The Supplier may")).toBe("");
    expect(typedNumberOf("2022 was a good year")).toBe("2022");
  });

  it("orders depth: heading 0, sub-clause 1, paragraph (a) below", () => {
    expect(typedDepth("3")).toBe(0);
    expect(typedDepth("2.2")).toBe(1);
    expect(typedDepth("(a)")).toBeGreaterThan(typedDepth("2.2.1"));
  });
});

describe("groundPlacement", () => {
  const doc =
    '1.4 "Term" means the Initial Term and any Renewal Term.\n2.2 The Supplier may change, suspend or withdraw any feature of the platform at any time without notice.';

  it("keeps a verbatim anchor and the clause number", () => {
    expect(
      groundPlacement({ insertAfter: "any feature of the platform at any time without notice.", insertAfterClause: "clause 2.2" }, doc),
    ).toEqual({ insertAfter: "any feature of the platform at any time without notice.", insertAfterClause: "2.2" });
  });

  it("drops a clause number copied in front of the anchor", () => {
    expect(groundPlacement({ insertAfter: '1.4 "Term" means the Initial Term and any Renewal Term.' }, doc)).toEqual({
      insertAfter: '"Term" means the Initial Term and any Renewal Term.',
      insertAfterClause: null,
    });
  });

  it("drops an anchor that is not in the document, keeping the number", () => {
    expect(groundPlacement({ insertAfter: "words the contract never says", insertAfterClause: "2.2" }, doc)).toEqual({
      insertAfter: null,
      insertAfterClause: "2.2",
    });
  });

  it("returns nulls for a missing placement", () => {
    expect(groundPlacement({}, doc)).toEqual({ insertAfter: null, insertAfterClause: null });
  });
});
