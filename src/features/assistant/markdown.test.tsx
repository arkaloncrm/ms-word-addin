import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown, type DocQuoteCtx } from "./markdown";

const ctx: DocQuoteCtx = { onQuote: async () => true };
const render = (text: string, docQuotes?: DocQuoteCtx) =>
  renderToStaticMarkup(<Markdown text={text} docQuotes={docQuotes} />);

describe("Markdown quoted contract wording", () => {
  it("turns a quoted passage into a link to the document", () => {
    const html = render('Clause 4.2 says "The obligations of confidentiality shall survive in perpetuity." That is long.', ctx);
    expect(html).toContain('class="msg__docquote"');
    expect(html).toContain('title="Show this wording in the document"');
    expect(html).toContain("The obligations of confidentiality shall survive in perpetuity.");
  });

  it("handles curly quotes too", () => {
    const html = render("The clause reads “the Recipient must return all documents” on request.", ctx);
    expect(html).toContain('class="msg__docquote"');
  });

  it("links quotes inside list items", () => {
    const html = render('- Term: "this Agreement continues for three (3) years"', ctx);
    expect(html).toContain("<li>");
    expect(html).toContain('class="msg__docquote"');
  });

  it("leaves quoted defined terms as plain text", () => {
    const html = render('The "Confidential Information" definition is broad.', ctx);
    expect(html).not.toContain("msg__docquote");
    expect(html).toContain("&quot;Confidential Information&quot;");
  });

  it("leaves quotes as plain text when there is no document context", () => {
    const html = render('Clause 4.2 says "The obligations of confidentiality shall survive in perpetuity."');
    expect(html).not.toContain("msg__docquote");
  });

  it("still renders bold text alongside a quote", () => {
    const html = render('**Risk.** It says "the Supplier may vary the fees at any time".', ctx);
    expect(html).toContain("<strong>Risk.</strong>");
    expect(html).toContain('class="msg__docquote"');
  });
});
