import { describe, expect, it } from "vitest";
import {
  assistantSystem,
  classifyContractPrompt,
  clauseFixPrompt,
  contractReviewPrompt,
  draftGeneratePrompt,
  explainPrompt,
  GROUNDING,
  REVIEW_INSTRUCTION_RULES,
  rewritePrompt,
} from "./prompts";

describe("GROUNDING (who the AI is)", () => {
  it("is ArkLaw, for Australian lawyers, under Australian law", () => {
    expect(GROUNDING).toContain("You are ArkLaw");
    expect(GROUNDING).toContain("Australian lawyers");
    expect(GROUNDING).toContain("assume Australian law");
    expect(GROUNDING).toContain("Australian English");
  });

  it("no longer calls itself Vaquill AI or a US assistant", () => {
    expect(GROUNDING).not.toContain("Vaquill");
    expect(GROUNDING).not.toMatch(/\bUS\b/);
  });

  it("keeps the document's own spelling in proposed wording", () => {
    expect(GROUNDING).toContain("match the spelling and defined terms the document already uses");
  });
});

describe("jurisdiction in the prompts", () => {
  it("names the state in full for a state code", () => {
    expect(clauseFixPrompt("Term", "x", "vic").system).toContain("under the law of Victoria, Australia");
    expect(explainPrompt("x", "qld").system).toContain("under the law of Queensland, Australia");
    expect(rewritePrompt("x", "y", "rewrite", "balanced", "wa").system).toContain(
      "under the law of Western Australia, Australia",
    );
  });

  it("says Australia for the country code or a blank", () => {
    expect(clauseFixPrompt("Term", "x", "AU").system).toContain("under the law of Australia.");
    expect(explainPrompt("x", "").system).toContain("under the law of Australia.");
  });

  it("drafts an Australian document under the chosen law", () => {
    const vic = draftGeneratePrompt("nda", "Mutual NDA", "balanced", "vic", "", "").system;
    expect(vic).toContain("professional Australian nda");
    expect(vic).toContain("governed by the law of Victoria, Australia");
    const au = draftGeneratePrompt("nda", "Mutual NDA", "balanced", "AU", "", "").system;
    expect(au).toContain("governed by the law of Australia.");
    expect(au).not.toMatch(/\bUS\b|federal/);
  });

  it("reviews under the lawyer's default jurisdiction unless the contract says otherwise", () => {
    const s = contractReviewPrompt("Contract.", "nda", "Acme Pty Ltd", "standard", undefined, undefined, "sa").system;
    expect(s).toContain(
      "Unless the contract's governing law clause says otherwise, assess it under the law of South Australia, Australia.",
    );
  });
});

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
