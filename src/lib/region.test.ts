import { describe, expect, it } from "vitest";
import { AU_JURISDICTIONS, COUNTRY_CODE, isJurisdictionCode, lawName } from "./region";

describe("AU_JURISDICTIONS", () => {
  it("lists Australia plus all six states and two territories", () => {
    expect(AU_JURISDICTIONS.map((j) => j.label)).toEqual([
      "Australia (no specific state)",
      "New South Wales",
      "Victoria",
      "Queensland",
      "Western Australia",
      "South Australia",
      "Tasmania",
      "Australian Capital Territory",
      "Northern Territory",
    ]);
  });

  it("has no US states left", () => {
    const labels = AU_JURISDICTIONS.map((j) => j.label).join(" ");
    expect(labels).not.toMatch(/California|New York|Delaware|Texas|Federal/);
  });
});

describe("lawName", () => {
  it("names a state or territory in full", () => {
    expect(lawName("nsw")).toBe("New South Wales, Australia");
    expect(lawName("ACT")).toBe("Australian Capital Territory, Australia");
    expect(lawName(" nt ")).toBe("Northern Territory, Australia");
  });

  it("treats blank, the country code and Commonwealth as Australia", () => {
    for (const c of ["", COUNTRY_CODE, "au", "cth", "Commonwealth", "federal", null, undefined]) {
      expect(lawName(c)).toBe("Australia");
    }
  });

  it("passes a deliberate other choice through unchanged", () => {
    expect(lawName("England and Wales")).toBe("England and Wales");
  });
});

describe("isJurisdictionCode", () => {
  it("accepts Australian codes and blank, rejects US state codes", () => {
    expect(isJurisdictionCode("")).toBe(true);
    expect(isJurisdictionCode("vic")).toBe(true);
    expect(isJurisdictionCode("ca")).toBe(false);
    expect(isJurisdictionCode("ny")).toBe(false);
  });
});
