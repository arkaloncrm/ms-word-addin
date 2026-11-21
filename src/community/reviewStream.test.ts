import { describe, expect, it, vi } from "vitest";

// The review shaper is pure; the AI runner is not needed (and needs a browser).
// Keep the real error classes: the stream's error path checks them.
vi.mock("./llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./llm")>()),
  runJson: vi.fn(),
}));

import { communityDraftFixStream, communityReviewStream, shapeReview } from "./reviewStream";
import { runJson } from "./llm";

describe("Australian law reaches the AI", () => {
  const events = { onEvent: vi.fn() };

  it("tells the review which state's law the lawyer set in Settings", async () => {
    vi.mocked(runJson).mockReset().mockResolvedValue({});
    await communityReviewStream(
      { documentText: "Contract.", contractType: "nda", dealContext: { governingLaw: "nsw" } },
      events as never,
    );
    const system = vi.mocked(runJson).mock.calls[0][0];
    expect(system).toContain("assess it under the law of New South Wales, Australia");
    expect(system).toContain("You are ArkLaw");
  });

  it("assumes Australia when no state is set", async () => {
    vi.mocked(runJson).mockReset().mockResolvedValue({});
    await communityReviewStream({ documentText: "Contract." }, events as never);
    expect(vi.mocked(runJson).mock.calls[0][0]).toContain("under the law of Australia.");
  });

  it("drafts a stronger clause under Australian law by default", async () => {
    vi.mocked(runJson).mockReset().mockResolvedValue({ proposedLanguage: "Better." });
    await communityDraftFixStream({ clauseName: "Confidentiality", currentLanguage: "Old." }, events as never);
    const system = vi.mocked(runJson).mock.calls[0][0];
    expect(system).toContain("under the law of Australia");
    expect(system).not.toMatch(/\bUS\b/);
  });
});

const DOC = "The Employee will be subject to a probationary period of six (6) months.";

describe("shapeReview", () => {
  it("carries the instruction a redline carries out, and leaves it null otherwise", () => {
    const review = shapeReview(
      {
        redlines: [
          {
            clauseName: "Probation",
            currentLanguage: "six (6) months",
            proposedLanguage: "three (3) months",
            rationale: "As instructed.",
            fromInstruction: "  probation to 3 months ",
          },
          {
            clauseName: "Termination",
            currentLanguage: "",
            proposedLanguage: "Either party may terminate on 4 weeks' notice.",
            rationale: "Missing.",
            fromInstruction: "   ",
          },
          { clauseName: "Fees", currentLanguage: "not in the contract", proposedLanguage: "x", rationale: "y" },
        ],
      },
      DOC,
      "employment",
      "Acme Pty Ltd (Employer)",
    );
    expect(review.redlines.map((r) => r.fromInstruction)).toEqual(["probation to 3 months", null, null]);
    // Grounding is unchanged by this work: exact wording is verified, empty is an insertion.
    expect(review.redlines.map((r) => r.grounding)).toEqual(["verified", "insertion", "unverified"]);
    expect(review.userSide).toBe("Acme Pty Ltd (Employer)");
  });

  it("keeps each flag's exact wording so the lawyer can jump to it", () => {
    const review = shapeReview(
      {
        flags: [
          {
            clauseName: "Probation",
            sectionReference: "2.1",
            observation: "Long for a junior role.",
            quote: " six (6) months ",
          },
          { clauseName: "Instruction not carried out", observation: "No non-compete clause to change." },
          { clauseName: "Empty", observation: "   " },
          "not a flag",
        ],
      },
      DOC,
      null,
      null,
    );
    expect(review.flags).toEqual([
      { clauseName: "Probation", sectionReference: "2.1", observation: "Long for a junior role.", quote: "six (6) months" },
      { clauseName: "Instruction not carried out", sectionReference: undefined, observation: "No non-compete clause to change." },
    ]);
  });

  it("returns empty lists when the model sends nothing usable", () => {
    const review = shapeReview({}, DOC, null, null);
    expect(review.redlines).toEqual([]);
    expect(review.flags).toEqual([]);
  });
});
