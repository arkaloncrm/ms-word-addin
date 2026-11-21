// The live add-in (Railway) is served by deploy/serve.mjs, whose
// Content-Security-Policy decides which hosts the Word pane may call. A host
// missing from connect-src fails silently in Word (the browser blocks the
// request), which is how Law cited showed "couldn't check the register right
// now" for every Act in the 20 Nov 2026 Word test. Pin the hosts here.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const serve = readFileSync(resolve(process.cwd(), "deploy/serve.mjs"), "utf8");
const connectSrc = serve.match(/"connect-src ([^"]+)"/)?.[1].split(/\s+/) ?? [];

describe("deploy/serve.mjs connect-src", () => {
  it("is found", () => {
    expect(connectSrc.length).toBeGreaterThan(3);
  });

  it("allows the Federal Register of Legislation API (Law cited)", () => {
    expect(connectSrc).toContain("https://api.prod.legislation.gov.au");
  });

  it("allows every AI provider the Settings screen offers", () => {
    for (const host of [
      "https://api.anthropic.com",
      "https://api.openai.com",
      "https://api.groq.com",
      "https://generativelanguage.googleapis.com",
      "https://*.openai.azure.com",
      "http://localhost:11434",
    ]) {
      expect(connectSrc).toContain(host);
    }
  });

  it("does not open the pane to any host at all", () => {
    expect(connectSrc).not.toContain("*");
    expect(connectSrc).not.toContain("https:");
    expect(connectSrc).not.toContain("http:");
  });
});
