// The AI key and the CourtListener token are masked text fields, not
// type="password": in the 20 Nov 2026 Word test, WebView2 offered "Save your
// password?" for the API key right after it was saved.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProviderKeyForm } from "./ProviderKeyForm";
import { CourtListenerCard } from "@/features/settings/CourtListenerCard";

function secretInputs(html: string): string[] {
  return html.match(/<input[^>]*secret-input[^>]*>/g) ?? [];
}

describe("secret fields", () => {
  it.each([
    ["the AI key", <ProviderKeyForm key="k" />],
    ["the CourtListener token", <CourtListenerCard key="c" />],
  ])("%s is a masked text field the browser will not offer to save", (_name, el) => {
    const html = renderToStaticMarkup(el);
    expect(html).not.toContain('type="password"');
    const inputs = secretInputs(html);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toContain('type="text"');
    expect(inputs[0]).toContain('autoComplete="off"');
    expect(inputs[0]).toContain("data-1p-ignore");
    expect(inputs[0]).not.toMatch(/name="[^"]*password/i);
  });
});
