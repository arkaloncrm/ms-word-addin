// Long documents are reviewed in sections. Word's structured text has ONE
// newline between paragraphs; the splitter used to break only on blank lines,
// so a whole contract was one "paragraph" and was cut mid-sentence.
import { describe, expect, it } from "vitest";
import { splitIntoSections } from "./sections";

function contract(clauses: number, wordsPerClause = 60): string {
  const lines: string[] = [];
  for (let c = 1; c <= clauses; c++) {
    lines.push(`${c}. Heading ${c}`);
    for (let s = 1; s <= 3; s++) {
      lines.push(`${c}.${s} ${Array.from({ length: wordsPerClause }, (_, w) => `word${w}`).join(" ")}.`);
    }
  }
  return lines.join("\n");
}

describe("splitIntoSections", () => {
  it("returns short text unchanged", () => {
    expect(splitIntoSections("1. A\n1.1 b", 1000)).toEqual(["1. A\n1.1 b"]);
  });

  it("splits single-newline text between paragraphs, never mid-sentence", () => {
    const text = contract(40);
    const parts = splitIntoSections(text, 6_000);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(6_000);
      // Every section ends at the end of a paragraph (a full stop, or a heading line).
      expect(p.trimEnd()).toMatch(/(\.|Heading \d+)$/);
    }
  });

  it("joins back into exactly the original text", () => {
    const text = contract(40);
    expect(splitIntoSections(text, 6_000).join("")).toBe(text);
    const withBlankLines = text.replace(/\n(\d+\. Heading)/g, "\n\n$1");
    expect(splitIntoSections(withBlankLines, 6_000).join("")).toBe(withBlankLines);
  });

  it("prefers to start a section at a clause heading once it is 80% full", () => {
    const parts = splitIntoSections(contract(40), 6_000);
    for (const p of parts.slice(1)) expect(p).toMatch(/^\d+\. Heading \d+/);
  });

  it("hard-splits a single paragraph longer than the limit as a last resort", () => {
    const parts = splitIntoSections("x".repeat(2_500), 1_000);
    expect(parts.map((p) => p.length)).toEqual([1_000, 1_000, 500]);
  });
});
