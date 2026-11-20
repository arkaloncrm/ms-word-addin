import { describe, expect, it } from "vitest";
import { REGULATIONS, regulationForPrompt, suggestRegulation } from "./regulations";

describe("REGULATIONS", () => {
  it("leads with the Privacy Act and lists Australian laws", () => {
    expect(REGULATIONS[0].label).toBe("Privacy Act 1988 (Cth)");
    const labels = REGULATIONS.map((r) => r.label);
    expect(labels).toContain("Australian Consumer Law");
    expect(labels).toContain("Fair Work Act 2009 (Cth)");
  });

  it("has no US-only laws left", () => {
    const values = REGULATIONS.map((r) => r.value);
    for (const us of ["ccpa", "hipaa", "glba", "ferpa", "tcpa", "sox"]) expect(values).not.toContain(us);
  });
});

describe("regulationForPrompt", () => {
  it("gives the AI the full name and what it covers", () => {
    expect(regulationForPrompt("au_privacy")).toBe(
      "Privacy Act 1988 (Cth) (Australian Privacy Principles: collection, use, disclosure, overseas transfers, and notifiable data breaches.)",
    );
  });

  it("passes an unknown value through", () => {
    expect(regulationForPrompt("something_else")).toBe("something_else");
  });
});

describe("suggestRegulation", () => {
  it("spots an Australian privacy document", () => {
    expect(
      suggestRegulation(
        "The Supplier must comply with the Privacy Act 1988 and the Australian Privacy Principles, " +
          "and notify the Customer of any eligible data breach.",
      ),
    ).toBe("au_privacy");
  });

  it("spots an Australian employment contract", () => {
    expect(
      suggestRegulation(
        "The Employee is covered by a modern award and the National Employment Standards under the Fair Work Act.",
      ),
    ).toBe("au_fair_work");
  });

  it("stays quiet when nothing is distinctive", () => {
    expect(suggestRegulation("The parties agree to meet monthly.")).toBeNull();
  });
});
