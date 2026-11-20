import { describe, expect, it } from "vitest";
import { MAX_PARTIES, normalizeParties, partySide } from "./parties";

describe("normalizeParties", () => {
  it("keeps named parties with their roles, trimming spacing", () => {
    expect(
      normalizeParties([
        { name: "  Acme   Pty Ltd ", role: " Discloser " },
        { name: "Beta Holdings Pty Ltd", role: "Recipient" },
      ]),
    ).toEqual([
      { name: "Acme Pty Ltd", role: "Discloser" },
      { name: "Beta Holdings Pty Ltd", role: "Recipient" },
    ]);
  });

  it("drops entries with no usable name and repeats of the same name", () => {
    expect(
      normalizeParties([
        { name: "", role: "Customer" },
        { role: "Supplier" },
        null,
        "Acme",
        { name: "Acme Pty Ltd", role: "Customer" },
        { name: "ACME PTY LTD", role: "Customer" },
      ]),
    ).toEqual([{ name: "Acme Pty Ltd", role: "Customer" }]);
  });

  it("keeps a party whose role is missing, with an empty role", () => {
    expect(normalizeParties([{ name: "Jordan Lee" }])).toEqual([{ name: "Jordan Lee", role: "" }]);
  });

  it("ignores sentence-length names", () => {
    expect(normalizeParties([{ name: "x".repeat(121), role: "Customer" }])).toEqual([]);
  });

  it(`keeps at most ${MAX_PARTIES} parties`, () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ name: `Party ${i}`, role: "Other" }));
    expect(normalizeParties(many)).toHaveLength(MAX_PARTIES);
  });

  it("returns an empty list for anything that is not a list", () => {
    expect(normalizeParties(undefined)).toEqual([]);
    expect(normalizeParties({ name: "Acme" })).toEqual([]);
  });
});

describe("partySide", () => {
  it("names the party and its role", () => {
    expect(partySide({ name: "Acme Pty Ltd", role: "Discloser" })).toBe("Acme Pty Ltd (Discloser)");
  });

  it("uses the name alone when the role is unknown", () => {
    expect(partySide({ name: "Jordan Lee", role: "" })).toBe("Jordan Lee");
  });
});
