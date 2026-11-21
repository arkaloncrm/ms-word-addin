// Fail-safe review: a review is shown ONLY when it provably completed. Anything
// cut off, refused, malformed or missing is an error, never an empty ("clean")
// review. Found in the 20 Nov 2026 Word test: a truncated answer showed "No
// redlines suggested. This contract looks clean" and "Clear to send" on a
// contract with 10 planted problems.
import { describe, expect, it, vi } from "vitest";

vi.mock("./llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./llm")>();
  return { ...actual, runJson: vi.fn() };
});

import {
  communityReviewStream,
  rankAndFilter,
  REVIEW_MAX_TOKENS,
  reviewMaxTokens,
  reviewProblem,
  shapeReview,
} from "./reviewStream";
import { IncompleteAnswerError, runJson } from "./llm";
import { contractReviewPrompt, normalizeReviewDepth, REVIEW_MATERIALITY_RULES, REVIEW_MAX_CHARS } from "@/ai/prompts";
import { MAX_DOCUMENT_CHARS, streamError } from "@/api/contract-review";
import { errorMessage } from "@/api/errors";
import type { RedlineSuggestion } from "@/api/types";

const DOC = "4.1 The Customer must pay each invoice within 7 days of the invoice date.";

function validReview(redlines: unknown[] = []): Record<string, unknown> {
  return {
    summary: "One-sided payment terms.",
    overallRisk: "red",
    redlines,
    missingClauses: [],
    negotiationPriorities: [],
    flags: [],
    reviewComplete: true,
  };
}

const PAYMENT = {
  clauseName: "Payment",
  sectionReference: "4.1",
  currentLanguage: "within 7 days",
  proposedLanguage: "within 30 days",
  rationale: "Seven days is unusually short.",
  severity: "medium",
  isDealBreaker: false,
  nature: "substantive",
  fromInstruction: null,
};

async function run(body: Record<string, unknown> = {}) {
  const events: { event: string; data: string }[] = [];
  await communityReviewStream({ documentText: DOC, ...body }, { onEvent: (e: { event: string; data: string }) => events.push(e) } as never);
  const result = events.find((e) => e.event === "result");
  const error = events.find((e) => e.event === "error");
  return {
    events,
    result: result ? JSON.parse(result.data).data : null,
    error: error ? (JSON.parse(error.data).message as string) : null,
  };
}

describe("reviewProblem: only a complete, well-formed review passes", () => {
  it("accepts a complete review, including one with no changes", () => {
    expect(reviewProblem(validReview([PAYMENT]))).toBeNull();
    expect(reviewProblem(validReview([]))).toBeNull();
  });

  it.each([
    ["not an object", null, "no review object"],
    ["an array", [], "no review object"],
    ["an empty object (the old false-clean case)", {}, "no completion marker"],
    ["no completion marker", { ...validReview(), reviewComplete: undefined }, "no completion marker"],
    ["completion marker false", { ...validReview(), reviewComplete: false }, "no completion marker"],
    ["completion marker as a string", { ...validReview(), reviewComplete: "true" }, "no completion marker"],
    ["no summary", { ...validReview(), summary: "  " }, "no summary"],
    ["a bad overall risk", { ...validReview(), overallRisk: "amber" }, "no overall risk"],
    ["redlines not a list", { ...validReview(), redlines: "none" }, "no list of changes"],
    ["a change with no explanation", validReview([{ ...PAYMENT, rationale: "" }]), "change 1 has no explanation"],
    ["a change with no clause name", validReview([PAYMENT, { ...PAYMENT, clauseName: undefined }]), "change 2 has no clause name"],
    ["a change with no proposed wording", validReview([{ ...PAYMENT, proposedLanguage: 5 }]), "change 1 has no proposed wording"],
    ["a change that is not an object", validReview(["x"]), "change 1 is not readable"],
    ["flags not a list", { ...validReview(), flags: {} }, "flags is not a list"],
  ])("rejects %s", (_name, raw, problem) => {
    expect(reviewProblem(raw)).toBe(problem);
  });
});

describe("communityReviewStream never reports a failed review as clean", () => {
  it("sends a result for a complete review with no changes (genuinely clean)", async () => {
    vi.mocked(runJson).mockReset().mockResolvedValue(validReview([]));
    const { result, error } = await run();
    expect(error).toBeNull();
    expect(result.redlines).toEqual([]);
  });

  it.each([
    ["an empty object", {}],
    ["a review without the completion marker", { ...validReview([PAYMENT]), reviewComplete: undefined }],
    ["a review with a malformed change", validReview([{ clauseName: "Payment" }])],
    ["a plain string", "no review"],
  ])("sends an error, never a result, for %s", async (_name, raw) => {
    vi.mocked(runJson).mockReset().mockResolvedValue(raw);
    const { result, error } = await run();
    expect(result).toBeNull();
    expect(error).toContain("Review not completed.");
    expect(error).toContain("Nothing has been marked as reviewed or clean.");
  });

  it.each([
    ["truncated", "cut off before it finished"],
    ["refused", "declined"],
    ["incomplete", "stopped before it finished"],
    ["unreadable", "could not be read"],
  ] as const)("sends an error, never a result, when the answer was %s", async (finish, words) => {
    vi.mocked(runJson).mockReset().mockRejectedValue(new IncompleteAnswerError(finish));
    const { result, error } = await run();
    expect(result).toBeNull();
    expect(error).toContain(words);
    expect(error).toContain("Nothing has been marked as reviewed or clean.");
  });

  it("sends an error for a network or key failure", async () => {
    vi.mocked(runJson).mockReset().mockRejectedValue(new Error("Cannot reach Anthropic. Check your connection."));
    const { result, error } = await run();
    expect(result).toBeNull();
    expect(error).toContain("Cannot reach Anthropic");
  });

  it("asks for a strict, long answer (the old 4,096-token cap cut reviews off)", async () => {
    vi.mocked(runJson).mockReset().mockResolvedValue(validReview([]));
    await run();
    const opts = vi.mocked(runJson).mock.calls[0][2];
    expect(opts).toMatchObject({ strict: true, maxTokens: REVIEW_MAX_TOKENS });
    expect(REVIEW_MAX_TOKENS).toBeGreaterThanOrEqual(32_000);
  });

  it("only a test build can force a tiny output budget; anything else gets the full budget", () => {
    expect(reviewMaxTokens(undefined)).toBe(REVIEW_MAX_TOKENS);
    expect(reviewMaxTokens("")).toBe(REVIEW_MAX_TOKENS);
    expect(reviewMaxTokens("300")).toBe(300);
    expect(reviewMaxTokens("5000")).toBe(REVIEW_MAX_TOKENS);
    expect(reviewMaxTokens("-1")).toBe(REVIEW_MAX_TOKENS);
    expect(reviewMaxTokens("abc")).toBe(REVIEW_MAX_TOKENS);
    // The normal test run (like production) has no override set.
    expect(reviewMaxTokens()).toBe(REVIEW_MAX_TOKENS);
  });

  it("refuses an over-long pass instead of cutting it silently", async () => {
    vi.mocked(runJson).mockReset().mockResolvedValue(validReview([]));
    const { result, error } = await run({ documentText: "x".repeat(REVIEW_MAX_CHARS + 1) });
    expect(runJson).not.toHaveBeenCalled();
    expect(result).toBeNull();
    expect(error).toContain("Nothing was reviewed");
  });

  it("shows the review's own failure message word for word (Word test, 21 Nov: it was replaced by a generic one)", () => {
    const msg = "Review not completed. The AI's answer was cut off before it finished (it reached its length limit). Nothing has been marked as reviewed or clean. Please try again.";
    expect(errorMessage(streamError(JSON.stringify({ message: msg }), "The review failed."))).toBe(msg);
    // No message at all: still an error, never a result.
    expect(errorMessage(streamError("{}", "The review failed."))).toContain("Please try again");
  });

  it("keeps the review pass limit in step with the section size", () => {
    expect(REVIEW_MAX_CHARS).toBe(MAX_DOCUMENT_CHARS);
  });
});

function rl(clauseName: string, severity: RedlineSuggestion["severity"], extra: Partial<RedlineSuggestion> = {}): RedlineSuggestion {
  return {
    clauseName,
    currentLanguage: "x",
    proposedLanguage: "y",
    rationale: "z",
    grounding: "verified",
    isDealBreaker: false,
    nature: "substantive",
    severity,
    ...extra,
  };
}

describe("ranking and the review modes", () => {
  const mixed = [
    rl("A low", "low"),
    rl("B high", "high"),
    rl("C cosmetic", "low", { nature: "housekeeping" }),
    rl("D medium", "medium"),
    rl("E asked-for cosmetic", "low", { nature: "housekeeping", fromInstruction: "fix the typo in 2.1" }),
    rl("F high", "high"),
  ];

  it("ranks high, medium, low and keeps the model's order within each", () => {
    const { redlines } = rankAndFilter(mixed, "comprehensive");
    expect(redlines.map((r) => r.clauseName)).toEqual([
      "B high",
      "F high",
      "D medium",
      "A low",
      "C cosmetic",
      "E asked-for cosmetic",
    ]);
  });

  it.each(["critical", "balanced"] as const)(
    "in %s mode, leaves out only cosmetic tidy-ups nobody asked for, and counts them",
    (depth) => {
      const { redlines, hiddenMinorCount } = rankAndFilter(mixed, depth);
      expect(redlines.map((r) => r.clauseName)).toEqual(["B high", "F high", "D medium", "A low", "E asked-for cosmetic"]);
      expect(hiddenMinorCount).toBe(1);
    },
  );

  it("never leaves out a material issue, however many there are (no cap)", () => {
    const many = Array.from({ length: 60 }, (_, i) => rl(`Issue ${i}`, i % 2 ? "high" : "medium"));
    for (const depth of ["critical", "balanced", "comprehensive"] as const) {
      expect(rankAndFilter(many, depth).redlines).toHaveLength(60);
    }
  });

  it("comprehensive mode hides nothing", () => {
    expect(rankAndFilter(mixed, "comprehensive").hiddenMinorCount).toBe(0);
  });

  it("rates conservatively when the model leaves severity out", () => {
    const review = shapeReview(
      validReview([
        { ...PAYMENT, clauseName: "Deal-breaker", severity: undefined, isDealBreaker: true },
        { ...PAYMENT, clauseName: "Cosmetic", severity: undefined, nature: "housekeeping" },
        { ...PAYMENT, clauseName: "Unrated", severity: undefined },
        { ...PAYMENT, clauseName: "Nonsense", severity: "urgent" },
      ]),
      DOC,
      null,
      null,
      "comprehensive",
    );
    const by = Object.fromEntries(review.redlines.map((r) => [r.clauseName, r.severity]));
    expect(by).toEqual({ "Deal-breaker": "high", Cosmetic: "low", Unrated: "medium", Nonsense: "medium" });
  });

  it("records the mode and the hidden count on the result", () => {
    const review = shapeReview(
      validReview([PAYMENT, { ...PAYMENT, clauseName: "Comma", severity: "low", nature: "housekeeping" }]),
      DOC,
      null,
      null,
      "balanced",
    );
    expect(review.reviewDepth).toBe("balanced");
    expect(review.hiddenMinorCount).toBe(1);
    expect(review.redlines.map((r) => r.clauseName)).toEqual(["Payment"]);
  });
});

describe("review modes reach the AI", () => {
  it("maps the old light / standard / firm values and defaults to Balanced", () => {
    expect(normalizeReviewDepth("light")).toBe("critical");
    expect(normalizeReviewDepth("standard")).toBe("balanced");
    expect(normalizeReviewDepth("firm")).toBe("comprehensive");
    expect(normalizeReviewDepth("critical")).toBe("critical");
    expect(normalizeReviewDepth("comprehensive")).toBe("comprehensive");
    expect(normalizeReviewDepth(undefined)).toBe("balanced");
    expect(normalizeReviewDepth("nonsense")).toBe("balanced");
  });

  it.each([
    ["critical", "REVIEW MODE: CRITICAL"],
    ["balanced", "REVIEW MODE: BALANCED"],
    ["comprehensive", "REVIEW MODE: COMPREHENSIVE"],
    ["standard", "REVIEW MODE: BALANCED"],
  ])("a %s review tells the AI its mode, the materiality rules and the completion marker", (mode, words) => {
    const p = contractReviewPrompt(DOC, "saas", "Customer", mode, undefined, undefined);
    expect(p.system).toContain(words);
    expect(p.system).toContain(REVIEW_MATERIALITY_RULES);
    expect(p.system).toContain('"reviewComplete": true}');
    expect(p.system).toContain("must be the LAST field");
    expect(p.user).toContain(DOC);
  });

  it("treats undefined terms and broken cross-references as material, not cosmetic", () => {
    expect(REVIEW_MATERIALITY_RULES).toContain("MATERIAL, not cosmetic");
    expect(REVIEW_MATERIALITY_RULES).toContain("never defined");
    expect(REVIEW_MATERIALITY_RULES).toContain("cross-reference to a clause that does not exist");
    expect(REVIEW_MATERIALITY_RULES).toContain("no limit on the number of findings");
  });
});
