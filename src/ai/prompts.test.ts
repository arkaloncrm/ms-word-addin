import { describe, expect, it } from "vitest";
import { assistantSystem, classifyContractPrompt, contractReviewPrompt, REVIEW_INSTRUCTION_RULES } from "./prompts";

describe("classifyContractPrompt", () => {
  it("asks for the contract's own party names and roles", () => {
    const p = classifyContractPrompt("Mutual NDA between Acme Pty Ltd and Beta Pty Ltd.");
    expect(p.system).toContain('"parties": [{"name": string, "role": string}]');
    expect(p.system).toContain("exactly as the contract names them");
  });
});

describe("contractReviewPrompt", () => {
  const review = (instructions?: string) =>
    contractReviewPrompt("Contract text.", "nda", "Acme Pty Ltd (Discloser)", "standard", undefined, instructions);

  it("reviews from the named party's side", () => {
    expect(review().system).toContain("from the Acme Pty Ltd (Discloser) side");
  });

  it("adds the instruction rules only when the lawyer typed instructions", () => {
    expect(review().system).not.toContain(REVIEW_INSTRUCTION_RULES);
    expect(review("   ").system).not.toContain(REVIEW_INSTRUCTION_RULES);
    const withRules = review("Change the term to 7 years.");
    expect(withRules.system).toContain(REVIEW_INSTRUCTION_RULES);
    expect(withRules.user).toContain("Reviewer instructions: Change the term to 7 years.");
  });

  it("asks for fromInstruction on redlines and the exact quote on flags", () => {
    const s = review().system;
    expect(s).toContain('"fromInstruction": string|null');
    expect(s).toContain('"quote": string');
  });

  it("tells the AI to report instructions it could not carry out", () => {
    expect(REVIEW_INSTRUCTION_RULES).toContain('"Instruction not carried out"');
  });
});

describe("assistantSystem", () => {
  it("asks for verbatim quotes when a document is open", () => {
    expect(assistantSystem("Clause 1. The term is 3 years.")).toContain("quote its exact words in double quotation marks");
  });

  it("does not ask for quotes when no document is open", () => {
    expect(assistantSystem("")).not.toContain("double quotation marks");
  });
});
