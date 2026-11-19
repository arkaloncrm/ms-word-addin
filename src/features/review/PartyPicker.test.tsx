import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PartyPicker } from "./PartyPicker";

const PARTIES = [
  { name: "Acme Pty Ltd", role: "Discloser" },
  { name: "Beta Holdings Pty Ltd", role: "Recipient" },
];
const noop = () => {};

describe("PartyPicker", () => {
  it("shows each party by its real name and role, plus Someone else", () => {
    const html = renderToStaticMarkup(
      <PartyPicker parties={PARTIES} chosen={null} other={false} onChoose={noop} onOther={noop} />,
    );
    expect(html).toContain("Which party are you acting for?");
    expect(html).toContain("Acme Pty Ltd (Discloser)");
    expect(html).toContain("Beta Holdings Pty Ltd (Recipient)");
    expect(html).toContain("Someone else");
    // Nothing is chosen for the lawyer: every button starts unpressed.
    expect(html).not.toContain('aria-pressed="true"');
  });

  it("marks the chosen party as pressed", () => {
    const html = renderToStaticMarkup(
      <PartyPicker parties={PARTIES} chosen={1} other={false} onChoose={noop} onOther={noop} />,
    );
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Beta Holdings Pty Ltd/);
  });

  it("shows nothing when the contract's parties were not found", () => {
    const html = renderToStaticMarkup(
      <PartyPicker parties={[]} chosen={null} other={false} onChoose={noop} onOther={noop} />,
    );
    expect(html).toBe("");
  });
});
