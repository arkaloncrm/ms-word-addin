import { describe, expect, it } from "vitest";
import { buildEmail, featureRequestsEnabled, parseRequest, MAX_TEXT } from "./feature-request.mjs";

describe("featureRequestsEnabled", () => {
  it("needs both the key and the destination, and honours FEATURE_REQUESTS=off", () => {
    expect(featureRequestsEnabled({})).toBe(false);
    expect(featureRequestsEnabled({ RESEND_API_KEY: "k" })).toBe(false);
    expect(featureRequestsEnabled({ RESEND_API_KEY: "k", FEATURE_REQUEST_TO: "a@b.co" })).toBe(true);
    expect(featureRequestsEnabled({ RESEND_API_KEY: "k", FEATURE_REQUEST_TO: "a@b.co", FEATURE_REQUESTS: "OFF" })).toBe(false);
  });
});

describe("parseRequest", () => {
  it("rejects bad JSON, empty and over-long text", () => {
    expect(parseRequest("nope").error).toBeTruthy();
    expect(parseRequest(JSON.stringify({ text: "   " })).error).toMatch(/describe/);
    expect(parseRequest(JSON.stringify({ text: "a".repeat(MAX_TEXT + 1) })).error).toMatch(/under/);
  });

  it("strips control characters and defaults an unknown source to typed", () => {
    const r = parseRequest(JSON.stringify({ text: "Dark\u0007 mode\r\nplease", source: "hacked", contact: "Jo\nBloggs" }));
    expect(r.value).toEqual({ text: "Dark mode\nplease", source: "typed", contact: "Jo Bloggs", version: "", host: "" });
  });
});

describe("buildEmail", () => {
  const now = new Date("2026-11-24T01:00:00Z");
  it("carries the request, how it was entered, who, when and the version", () => {
    const m = buildEmail({ text: "Pick a state per document", source: "dictated", contact: "", version: "0.1.0 (community)", host: "PC 16.0" }, now);
    expect(m.subject).toBe("ArkLaw feature request: Pick a state per document");
    expect(m.text).toContain("Pick a state per document");
    expect(m.text).toContain("Entered: dictated");
    expect(m.text).toContain("From: not given");
    expect(m.text).toContain("2026-11-24T01:00:00.000Z");
    expect(m.text).toContain("Add-in version: 0.1.0 (community)");
    expect(m.text).toContain("Word: PC 16.0");
    expect(m.replyTo).toBeUndefined();
  });

  it("sets reply-to only for a real-looking email, and keeps the subject to one line", () => {
    const m = buildEmail({ text: "Line one\nline two", source: "typed", contact: "tester@example.com", version: "", host: "" }, now);
    expect(m.replyTo).toBe("tester@example.com");
    expect(m.subject).toBe("ArkLaw feature request: Line one...");
    expect(m.subject).not.toMatch(/\n/);
  });
});
