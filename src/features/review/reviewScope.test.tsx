// Long documents and partial reviews: the scope of every review is stated, a
// section that fails is never counted as clean, and a partial review is never
// "Clear to send".
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ContractReviewResponse, RedlineSuggestion } from "@/api/types";
import { mergeReviews } from "@/lib/sections";
import { severityOf } from "@/lib/severity";
import { countWords, NO_RESULT_MESSAGE, runSections, sectionLabel } from "./useReview";
import { reviewScopeText } from "./scope";
import { SignoffGate } from "./SignoffGate";

function review(id: string, extra: Partial<ContractReviewResponse> = {}): ContractReviewResponse {
  return {
    id,
    summary: `Summary ${id}`,
    overallRisk: "yellow",
    redlines: [],
    negotiationPriorities: [],
    missingClauses: [],
    approvalGate: { required: false, level: null, dealBreakerCount: 0, reasons: [], summary: "No deal-breakers flagged." },
    flags: [],
    ...extra,
  };
}

const sections = ["1. Definitions\nalpha", "\n  7. Confidentiality\nbeta", "14. Dispute Resolution\ngamma"];

describe("runSections", () => {
  it("reviews every section when each delivers a review", async () => {
    const out = await runSections(sections, async (_t, i) => review(String(i)), () => false);
    expect(out.parts.map((p) => p.id)).toEqual(["0", "1", "2"]);
    expect(out.sectionError).toBeNull();
  });

  it("treats a section whose stream ended with no review as FAILED, not clean", async () => {
    const out = await runSections(sections, async (_t, i) => (i === 1 ? null : review(String(i))), () => false);
    expect(out.parts.map((p) => p.id)).toEqual(["0"]);
    expect(out.sectionError?.message).toBe(NO_RESULT_MESSAGE);
    expect(out.aborted).toBe(false);
  });

  it("keeps finished sections and reports the error when a later section fails", async () => {
    const out = await runSections(
      sections,
      async (_t, i) => {
        if (i === 2) throw new Error("Review not completed. The AI's answer was cut off.");
        return review(String(i));
      },
      () => false,
    );
    expect(out.parts).toHaveLength(2);
    expect(out.sectionError?.message).toContain("cut off");
  });

  it("stops quietly when the lawyer cancels", async () => {
    let aborted = false;
    const out = await runSections(sections, async (_t, i) => {
      if (i === 0) aborted = true;
      return review(String(i));
    }, () => aborted);
    expect(out.aborted).toBe(true);
  });
});

describe("naming what was not reviewed", () => {
  it("labels a section by its first non-empty line", () => {
    expect(sectionLabel(sections[1])).toBe("7. Confidentiality");
    expect(sectionLabel("x".repeat(100))).toHaveLength(70);
    expect(sectionLabel("   \n  ")).toBe("");
  });
});

describe("review scope line", () => {
  it("states a whole-document review read in one pass", () => {
    expect(reviewScopeText({ kind: "document", parts: 1, chars: 4_313, words: 703 }, "balanced")).toBe(
      "Reviewed: the whole document (about 700 words) · Balanced mode",
    );
  });

  it("states a long document reviewed in parts, in words a lawyer can check against Word", () => {
    // The 71-page test contract: Word's status bar says 40,634 words.
    expect(reviewScopeText({ kind: "document", parts: 2, chars: 252_365, words: 40_634 }, "critical")).toBe(
      "Reviewed: the whole document (about 40,600 words), in 2 parts · Critical mode",
    );
  });

  it("says plainly when only a selection was reviewed", () => {
    expect(reviewScopeText({ kind: "selection", parts: 1, chars: 300, words: 48 })).toBe(
      "Reviewed: your selection only (about 48 words)",
    );
  });

  it("counts words the way Word does (whitespace-separated)", () => {
    expect(countWords("  4.1 The Customer must\npay within 7 days. ")).toBe(8);
    expect(countWords("   ")).toBe(0);
  });
});

describe("SignoffGate", () => {
  const gate = { required: false, level: null, dealBreakerCount: 0, reasons: [], summary: "No deal-breakers flagged." };

  it("says Clear to send for a complete review with no deal-breakers", () => {
    expect(renderToStaticMarkup(<SignoffGate gate={gate} />)).toContain("Clear to send");
  });

  it("NEVER says Clear to send when part of the document was not reviewed", () => {
    const html = renderToStaticMarkup(<SignoffGate gate={gate} incomplete />);
    expect(html).not.toContain("Clear to send");
    expect(html).toContain("Not cleared: review incomplete");
  });

  it("still demands sign-off for deal-breakers in a partial review", () => {
    const html = renderToStaticMarkup(
      <SignoffGate gate={{ ...gate, required: true, dealBreakerCount: 1 }} incomplete />,
    );
    expect(html).toContain("Sign-off required before sending");
  });
});

describe("merging a sectioned review", () => {
  const r = (clauseName: string, severity: RedlineSuggestion["severity"]): RedlineSuggestion => ({
    clauseName,
    currentLanguage: "",
    proposedLanguage: "",
    rationale: "x",
    grounding: "insertion",
    isDealBreaker: false,
    severity,
  });

  it("ranks across sections, keeps every section's flags and adds up hidden tidy-ups", () => {
    const merged = mergeReviews([
      review("a", {
        redlines: [r("A low", "low"), r("A medium", "medium")],
        flags: [{ clauseName: "F1", observation: "one" }],
        hiddenMinorCount: 2,
      }),
      review("b", {
        redlines: [r("B high", "high")],
        flags: [{ clauseName: "F2", observation: "two" }],
        hiddenMinorCount: 1,
      }),
    ]);
    expect(merged.redlines.map((x) => x.clauseName)).toEqual(["B high", "A medium", "A low"]);
    expect(merged.flags?.map((f) => f.clauseName)).toEqual(["F1", "F2"]);
    expect(merged.hiddenMinorCount).toBe(3);
  });
});

describe("severityOf", () => {
  it("uses the reviewer's own rating (BYOK reviews used to show every issue as Low)", () => {
    expect(severityOf({ isDealBreaker: false, severity: "medium" })).toBe("medium");
    expect(severityOf({ isDealBreaker: false, severity: "high" })).toBe("high");
  });

  it("keeps deal-breakers and partner sign-off high whatever the rating", () => {
    expect(severityOf({ isDealBreaker: true, severity: "low" })).toBe("high");
    expect(severityOf({ isDealBreaker: false, approvalLevel: "gc", severity: "low" })).toBe("high");
  });

  it("falls back to the old heuristic for reviews without a rating", () => {
    expect(severityOf({ isDealBreaker: false, approvalLevel: "manager" })).toBe("medium");
    expect(severityOf({ isDealBreaker: false })).toBe("low");
  });
});
