// Audit finding F07: "verified" used to mean only "the wording appears
// somewhere". It now means "appears exactly once", so the label can never
// claim certainty about which words a change is about when the wording repeats.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { groundingFor, regradeGrounding } from "./grounding";
import { shapeReview } from "@/community/reviewStream";
import { GroundingBadge } from "@/features/review/GroundingBadge";
import type { RedlineSuggestion } from "@/api/types";

const DOC =
  "4.1 The Customer must pay within 7 days.\n" +
  "10.1 The Supplier may terminate on 7 days written notice.\n" +
  "4.3 The Supplier may increase the Fees on 7 days written notice.";

describe("groundingFor", () => {
  it("is verified only when the wording occurs exactly once", () => {
    expect(groundingFor("pay within 7 days", DOC)).toEqual({ grounding: "verified" });
  });

  it("is unverified, with a reason, when the wording occurs more than once", () => {
    const g = groundingFor("7 days written notice", DOC);
    expect(g.grounding).toBe("unverified");
    expect(g.groundingNote).toContain("appears 2 times");
    expect(groundingFor("7 days", DOC).groundingNote).toContain("3 or more times");
  });

  it("is unverified, with a reason, when the wording is not found word for word", () => {
    const g = groundingFor("within 30 days", DOC);
    expect(g.grounding).toBe("unverified");
    expect(g.groundingNote).toContain("not found word for word");
  });

  it("treats empty wording as a new clause", () => {
    expect(groundingFor("", DOC)).toEqual({ grounding: "insertion" });
  });

  it("counts overlapping repeats", () => {
    expect(groundingFor("aa", "aaa").grounding).toBe("unverified");
  });
});

describe("review cards", () => {
  it("a review card for repeated wording is not labelled verified", () => {
    const review = shapeReview(
      {
        summary: "s",
        overallRisk: "red",
        reviewComplete: true,
        redlines: [
          { clauseName: "Notice", currentLanguage: "7 days written notice", proposedLanguage: "30 days written notice", rationale: "r", severity: "medium" },
          { clauseName: "Payment", currentLanguage: "pay within 7 days", proposedLanguage: "pay within 30 days", rationale: "r", severity: "medium" },
        ],
      },
      DOC,
      null,
      null,
    );
    expect(review.redlines.map((r) => [r.clauseName, r.grounding])).toEqual([
      ["Notice", "unverified"],
      ["Payment", "verified"],
    ]);
    expect(review.redlines[0].groundingNote).toContain("appears 2 times");
  });

  it("a sectioned review is re-graded against the whole document", () => {
    const fromSection: RedlineSuggestion = {
      clauseName: "Notice",
      currentLanguage: "7 days written notice",
      proposedLanguage: "30 days",
      rationale: "r",
      grounding: "verified", // unique within its own section
      isDealBreaker: false,
    };
    const [r] = regradeGrounding([fromSection], DOC);
    expect(r.grounding).toBe("unverified");
  });

  it("the badge shows why a clause needs checking", () => {
    const html = renderToStaticMarkup(<GroundingBadge grounding="unverified" note="This wording appears 2 times in the document, so check which one is meant." />);
    expect(html).toContain("Verify manually");
    expect(html).toContain('title="This wording appears 2 times');
  });
});
