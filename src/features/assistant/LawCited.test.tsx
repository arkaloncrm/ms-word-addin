import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LawCited } from "./LawCited";
import type { RegisterClient } from "@/legal/verify";

const client: RegisterClient = {
  searchTitles: vi.fn(async () => ({ count: 0, titles: [] })),
  findVersion: vi.fn(async () => null),
  loadAct: vi.fn(async () => ({ provisions: [], endnotes: "" })),
  webLink: (id: string) => id,
};

describe("LawCited", () => {
  it("shows nothing when the answer cites no Act", () => {
    expect(renderToStaticMarkup(<LawCited text="Confidentiality usually lasts five years." client={client} />)).toBe("");
  });

  it("shows the check, the register's credit line and its licence when an Act is cited", () => {
    const html = renderToStaticMarkup(
      <LawCited text="Under section 6 of the Privacy Act 1988 (Cth), personal information means ..." client={client} />,
    );
    expect(html).toContain("Law cited");
    expect(html).toContain("checked against the Federal Register of Legislation");
    expect(html).toContain("Checking the Act on the official register");
    expect(html).toContain("Based on content from the Federal Register of Legislation at");
    expect(html).toContain("https://creativecommons.org/licenses/by/4.0/");
    expect(html).toContain("Commonwealth laws only for now.");
  });
});
