import { describe, expect, it } from "vitest";
import { listDefinedTerms } from "./defined-terms";

const NDA = `This Mutual Non-Disclosure Agreement (this "Agreement") is between Acme Pty Ltd ("Acme") and Beta Pty Ltd ("Beta").
"Confidential Information" means any information disclosed by a party.
"Purpose" means evaluating a possible joint venture. The Recipient (the "Recipient") must keep Confidential Information secret.
"Purpose" means something else.`;

describe("listDefinedTerms", () => {
  it("lists each defined term once", () => {
    const terms = listDefinedTerms(NDA);
    for (const t of ["Agreement", "Acme", "Beta", "Confidential Information", "Purpose", "Recipient"]) {
      expect(terms).toContain(t);
    }
    expect(terms.filter((t) => t === "Purpose")).toHaveLength(1);
  });

  it("caps the list", () => {
    expect(listDefinedTerms(NDA, 2)).toHaveLength(2);
    expect(listDefinedTerms("No definitions here.")).toEqual([]);
  });
});
