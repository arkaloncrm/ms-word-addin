import { describe, expect, it } from "vitest";
import { sanitizeReviewPrefs } from "./prefs";

describe("sanitizeReviewPrefs", () => {
  it("keeps an Australian jurisdiction, lowercased", () => {
    expect(sanitizeReviewPrefs({ jurisdiction: "NSW" }).jurisdiction).toBe("nsw");
    expect(sanitizeReviewPrefs({ jurisdiction: "vic" }).jurisdiction).toBe("vic");
  });

  it("turns a US state saved by the old build into Australia", () => {
    expect(sanitizeReviewPrefs({ jurisdiction: "ca" }).jurisdiction).toBe("");
    expect(sanitizeReviewPrefs({ jurisdiction: "NY" }).jurisdiction).toBe("");
  });

  it("falls back to empty defaults for junk", () => {
    expect(sanitizeReviewPrefs(null)).toEqual({ matterId: "", jurisdiction: "", contractType: "" });
    expect(sanitizeReviewPrefs({ jurisdiction: 7, matterId: "m1", contractType: "nda" })).toEqual({
      matterId: "m1",
      jurisdiction: "",
      contractType: "nda",
    });
  });
});
