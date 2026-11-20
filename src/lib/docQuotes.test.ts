import { describe, expect, it } from "vitest";
import { isDocQuote, MAX_DOC_QUOTE_CHARS } from "./docQuotes";

describe("isDocQuote", () => {
  it("accepts a quoted passage of contract wording", () => {
    expect(isDocQuote("the Recipient must return or destroy all Confidential Information")).toBe(true);
  });

  it("rejects defined terms and single words", () => {
    expect(isDocQuote("Confidential Information")).toBe(false);
    expect(isDocQuote("Agreement")).toBe(false);
  });

  it("rejects very short and very long text", () => {
    expect(isDocQuote("a b c")).toBe(false);
    expect(isDocQuote("word ".repeat(200))).toBe(false);
    expect("word ".repeat(200).trim().length).toBeGreaterThan(MAX_DOC_QUOTE_CHARS);
  });

  it("rejects web addresses", () => {
    expect(isDocQuote("https://www.legislation.gov.au/C2004A03712/latest")).toBe(false);
  });
});
