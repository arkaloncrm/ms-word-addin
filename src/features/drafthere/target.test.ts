import { describe, expect, it } from "vitest";
import { clauseName, describeTarget, findDraftTarget, isHeadingLike, type CursorParagraphs } from "./target";

const at = (current: string, previous = "", extra: Partial<CursorParagraphs> = {}): CursorParagraphs => ({
  current,
  previous,
  isHeadingStyle: false,
  inTable: false,
  ...extra,
});

describe("clauseName", () => {
  it("drops numbering and trailing punctuation", () => {
    expect(clauseName("5.3 Return of Data.")).toBe("Return of Data");
    expect(clauseName("(b) Audit Rights:")).toBe("Audit Rights");
    expect(clauseName("Clause 12 Confidentiality")).toBe("Confidentiality");
    expect(clauseName("Return of Data")).toBe("Return of Data");
  });
});

describe("isHeadingLike", () => {
  it("accepts short headings, numbered or run-in", () => {
    for (const h of ["Return of Data", "5.3 Return of Data", "Return of Data.", "4.7 Non-Competition", "Data Security:"]) {
      expect(isHeadingLike(h)).toBe(true);
    }
  });

  it("accepts a sentence-case heading typed with a full stop, and a title-case one starting with The", () => {
    expect(isHeadingLike("Return and destruction of customer data.")).toBe(true);
    expect(isHeadingLike("The Services.")).toBe(true);
  });

  it("rejects short sentences that start like clause text", () => {
    expect(isHeadingLike("The parties agree as follows.")).toBe(false);
    expect(isHeadingLike("The Supplier must comply")).toBe(false);
  });

  it("rejects short sentences of clause text that contain a verb", () => {
    expect(isHeadingLike("Payment is due within 30 days.")).toBe(false);
    expect(isHeadingLike("Fees are payable monthly")).toBe(false);
    expect(isHeadingLike("This clause survives termination.")).toBe(false);
    // Title case is still a heading.
    expect(isHeadingLike("What Survives Termination")).toBe(true);
  });

  it("will not write onto or under an existing short sentence", () => {
    expect(findDraftTarget(at("Payment is due within 30 days.")).ok).toBe(false);
    expect(findDraftTarget(at("", "Payment is due within 30 days.")).ok).toBe(false);
  });

  it("rejects clause text, sentences and list fragments", () => {
    expect(isHeadingLike("Return of Data. The Supplier must return all Customer Data within 30 days.")).toBe(false);
    expect(isHeadingLike("The Supplier must keep all Confidential Information secure at all times.")).toBe(false);
    expect(isHeadingLike("the Customer's data;")).toBe(false);
    expect(isHeadingLike("")).toBe(false);
    expect(isHeadingLike("12.")).toBe(false);
  });
});

describe("findDraftTarget", () => {
  it("drafts below a plain heading", () => {
    expect(findDraftTarget(at("5.3 Return of Data"))).toEqual({
      ok: true,
      heading: "Return of Data",
      note: "",
      placement: "below",
      strikePreviousNote: false,
      strikeInlineNote: "",
    });
  });

  it("continues on the same line after a run-in heading", () => {
    const t = findDraftTarget(at("3.2 Annual Bonus."));
    expect(t.ok && t.placement).toBe("same-line");
  });

  it("writes below a Word Heading style even when it ends in a full stop", () => {
    const t = findDraftTarget(at("Annual Bonus.", "", { isHeadingStyle: true }));
    expect(t.ok && t.placement).toBe("below");
  });

  it("replaces a note on its own line, using the heading above", () => {
    const t = findDraftTarget(at("[Draft: encryption at rest, 72-hour breach notice]", "Data Security"));
    expect(t).toMatchObject({ ok: true, heading: "Data Security", note: "encryption at rest, 72-hour breach notice", placement: "replace-note" });
  });

  it("keeps a heading that shares the line with a note, and strikes only the note", () => {
    const t = findDraftTarget(at("Data Security [draft: encryption at rest]"));
    expect(t).toMatchObject({
      ok: true,
      heading: "Data Security",
      note: "encryption at rest",
      placement: "below",
      strikeInlineNote: "[draft: encryption at rest]",
    });
  });

  it("follows a note on the line above the heading, and strikes it", () => {
    const t = findDraftTarget(at("Data Security", "[Draft: encryption at rest]"));
    expect(t).toMatchObject({ ok: true, heading: "Data Security", note: "encryption at rest", strikePreviousNote: true });
  });

  it("fills an empty line below a heading", () => {
    const t = findDraftTarget(at("", "Return of Data"));
    expect(t).toMatchObject({ ok: true, heading: "Return of Data", placement: "fill-empty" });
  });

  it("fills an empty line from typed instructions alone", () => {
    expect(findDraftTarget(at("", "The parties agree as follows."), "a short survival clause").ok).toBe(true);
    expect(findDraftTarget(at("", "The parties agree as follows.")).ok).toBe(false);
  });

  it("refuses a paragraph that already has text, and tables", () => {
    const body = findDraftTarget(at("The Supplier must return all Customer Data within 30 days of termination."));
    expect(body.ok).toBe(false);
    expect(!body.ok && body.reason).toContain("already has text");
    const table = findDraftTarget(at("Return of Data", "", { inTable: true }));
    expect(!table.ok && table.reason).toContain("outside tables");
  });
});

describe("describeTarget", () => {
  it("says what will be drafted", () => {
    const t = findDraftTarget(at("Data Security", "[Draft: encryption]"));
    expect(t.ok && describeTarget(t)).toBe('"Data Security", following your note');
  });
});
