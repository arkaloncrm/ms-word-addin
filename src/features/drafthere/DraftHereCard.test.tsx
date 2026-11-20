import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DraftHereCard } from "./DraftHereCard";

describe("DraftHereCard", () => {
  it("explains what to do and waits for Word", () => {
    const html = renderToStaticMarkup(<DraftHereCard />);
    expect(html).toContain("Draft here");
    expect(html).toContain("Put your cursor on a clause heading");
    expect(html).toContain("as a tracked change");
    expect(html).toContain("Anything to add? (optional)");
    // Outside Word there is nothing to draft into.
    expect(html).toContain("Open a contract in Word to use Draft here.");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Draft here<\/button>/);
  });
});
