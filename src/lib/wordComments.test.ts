import { describe, expect, it } from "vitest";
import { formatCommentsForAi } from "./wordComments";

describe("formatCommentsForAi", () => {
  it("says plainly when there are no comments", () => {
    expect(formatCommentsForAi({ comments: [], failed: false })).toBe(
      "[WORD COMMENTS]\nThis document has no Word comments.",
    );
  });

  it("says plainly when comments could not be read", () => {
    expect(formatCommentsForAi({ comments: [], failed: true })).toMatch(/could not be read/);
  });

  it("lists each comment with author, state, anchored text and replies", () => {
    const out = formatCommentsForAi({
      failed: false,
      comments: [
        {
          id: "1",
          author: "Michelle",
          text: "Too one-sided?",
          resolved: false,
          anchorText: "The Customer indemnifies the Supplier",
          replies: [{ author: "Stuart", text: "Agreed, soften it." }],
        },
        { id: "2", author: "", text: "Check   date", resolved: true, anchorText: "", replies: [] },
      ],
    });
    expect(out).toContain("[WORD COMMENTS] (2, in document order)");
    expect(out).toContain('1. Michelle (open) on "The Customer indemnifies the Supplier": Too one-sided?');
    expect(out).toContain("   Reply from Stuart: Agreed, soften it.");
    expect(out).toContain("2. Unknown (resolved): Check date");
  });

  it("clips a very long anchor", () => {
    const out = formatCommentsForAi({
      failed: false,
      comments: [{ id: "1", author: "A", text: "x", resolved: false, anchorText: "w ".repeat(1000), replies: [] }],
    });
    expect(out.length).toBeLessThan(500);
  });
});
