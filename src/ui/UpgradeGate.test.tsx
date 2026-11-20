import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { UpgradeGate, UpgradeLink } from "./UpgradeGate";
import { Header } from "./Header";

describe("locked features in ArkLaw", () => {
  it("say Not in ArkLaw yet and link nowhere", () => {
    const card = renderToStaticMarkup(<UpgradeGate title="Client rules">Standing positions.</UpgradeGate>);
    expect(card).toContain("Client rules");
    expect(card).toContain("Standing positions. Not in ArkLaw yet.");
    expect(card).not.toContain("<a");
    expect(card).not.toContain("vaquill");

    // A gate the lawyer can unlock themselves (a token in Settings) does not say "not yet".
    const unlockable = renderToStaticMarkup(
      <UpgradeGate title="Add a token" notYet={false}>
        Add your token in Settings.
      </UpgradeGate>,
    );
    expect(unlockable).toContain("Add your token in Settings.");
    expect(unlockable).not.toContain("Not in ArkLaw yet");

    const link = renderToStaticMarkup(<UpgradeLink label="Matters" />);
    expect(link).toContain("Matters");
    expect(link).toContain('aria-disabled="true"');
    expect(link).not.toContain("href");
  });
});

describe("Header", () => {
  it("shows the ArkLaw name", () => {
    const html = renderToStaticMarkup(<Header />);
    expect(html).toContain("ArkLaw");
    expect(html).not.toContain("Vaquill");
  });
});
