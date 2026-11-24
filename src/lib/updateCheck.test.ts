import { describe, expect, it } from "vitest";
import { formatBuildTime, isNewerBuild } from "./updateCheck";

describe("isNewerBuild", () => {
  const cur = { version: "0.1.0", buildId: "2026-11-24T10:00:00.000Z" };
  it("is true only for a later build", () => {
    expect(isNewerBuild(cur, { version: "0.1.0", buildId: "2026-11-24T12:00:00.000Z" })).toBe(true);
    expect(isNewerBuild(cur, { version: "0.1.0", buildId: "2026-11-24T10:00:00.000Z" })).toBe(false);
    expect(isNewerBuild(cur, { version: "0.1.0", buildId: "2026-11-23T10:00:00.000Z" })).toBe(false);
  });
  it("is false when either side is unknown", () => {
    expect(isNewerBuild(cur, null)).toBe(false);
    expect(isNewerBuild({ version: "0.1.0", buildId: "" }, { version: "0.1.0", buildId: "2026-11-24T12:00:00.000Z" })).toBe(false);
  });
});

describe("formatBuildTime", () => {
  it("shows Sydney time", () => {
    expect(formatBuildTime("2026-11-24T11:40:00.000Z")).toMatch(/24 Nov 2026/);
    expect(formatBuildTime("2026-11-24T11:40:00.000Z")).toMatch(/10:40/);
  });
  it("returns empty for a bad id", () => {
    expect(formatBuildTime("")).toBe("");
    expect(formatBuildTime("nope")).toBe("");
  });
});
