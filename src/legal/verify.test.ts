import { describe, expect, it, vi } from "vitest";
import { attribution, checkSection, verifyCitations, type RegisterClient } from "./verify";
import type { ActText } from "./actText";
import type { Title, Version } from "./frl";

const PRIVACY: Title = { id: "C2004A03712", name: "Privacy Act 1988", collection: "Act", status: "InForce", isPrincipal: true, isInForce: true };
const OLD: Title = { id: "C1900A00001", name: "Old Act 1990", collection: "Act", status: "Repealed", isPrincipal: true, isInForce: false };
const VERSION: Version = { titleId: PRIVACY.id, name: PRIVACY.name, status: "InForce", start: "2026-01-01", registerId: "C2026C00227" };
const ACT: ActText = {
  provisions: [
    { no: "6", heading: "Interpretation", context: "", body: "(1) In this Act ..." },
    { no: "13", heading: "Interferences with privacy", context: "", body: "An act or practice ..." },
  ],
  endnotes: "",
  // The Act's own table of contents, which "not in this Act" must agree with.
  toc: ["6", "13"],
};

function client(over: Partial<RegisterClient> = {}): RegisterClient {
  return {
    searchTitles: vi.fn(async (q: string) => {
      if (q === "Privacy Act 1988") return { count: 2, titles: [{ ...PRIVACY, id: "F2009L04608", name: "Privacy Act 1988 - Approval" }, PRIVACY] };
      if (q === "Old Act 1990") return { count: 1, titles: [OLD] };
      if (q === "Privacy Act 1998") return { count: 0, titles: [] };
      return { count: 0, titles: [] };
    }),
    findVersion: vi.fn(async () => VERSION),
    loadAct: vi.fn(async () => ACT),
    webLink: (id: string) => `https://www.legislation.gov.au/${id}/latest/text`,
    ...over,
  };
}

describe("verifyCitations", () => {
  it("finds the Act by its exact name and checks each section", async () => {
    const [a] = await verifyCitations("See s 6 and s 999 of the Privacy Act 1988 (Cth).", client());
    expect(a).toMatchObject({
      cited: "Privacy Act 1988",
      jurisdiction: "Cth",
      status: "in-force",
      titleId: "C2004A03712",
      closest: false,
      link: "https://www.legislation.gov.au/C2004A03712/latest/text",
    });
    expect(a.sections).toEqual([
      { no: "6", status: "found", heading: "Interpretation", body: "(1) In this Act ..." },
      { no: "999", status: "not-found", note: "This Act's current version has no section 999." },
    ]);
  });

  it("never looks a state Act up on the Commonwealth register", async () => {
    const c = client();
    const [a] = await verifyCitations("Section 5B of the Civil Liability Act 2002 (NSW) applies.", c);
    expect(a).toMatchObject({ status: "state-law", jurisdiction: "NSW" });
    expect(a.sections[0].status).toBe("not-checked");
    expect(c.searchTitles).not.toHaveBeenCalled();
  });

  it("flags an Act that is no longer in force", async () => {
    const [a] = await verifyCitations("Under the Old Act 1990.", client());
    expect(a).toMatchObject({ status: "not-in-force", registerStatus: "Repealed" });
  });

  it("says not found on the Commonwealth register, without inventing a match", async () => {
    const [a] = await verifyCitations("Under s 6 of the Privacy Act 1998.", client());
    expect(a.status).toBe("no-match");
    expect(a.sections).toEqual([{ no: "6", status: "not-checked" }]);
  });

  it("does not check sections against a title that only roughly matches", async () => {
    const c = client({
      searchTitles: vi.fn(async () => ({ count: 1, titles: [{ ...PRIVACY, name: "Privacy Amendment Act 2012" }] })),
    });
    const [a] = await verifyCitations("s 6 of the Privacy Act 2012", c);
    expect(a.closest).toBe(true);
    expect(a.sections[0].status).toBe("not-checked");
    expect(c.loadAct).not.toHaveBeenCalled();
  });

  it("says couldn't check, never not found, when the register is unreachable", async () => {
    const down = client({ searchTitles: vi.fn(async () => Promise.reject(new Error("offline"))) });
    const [a] = await verifyCitations("s 6 of the Privacy Act 1988", down);
    expect(a.status).toBe("unverified");
    expect(a.sections[0].status).toBe("unverified");

    const noText = client({ loadAct: vi.fn(async () => Promise.reject(new Error("download failed"))) });
    const [b] = await verifyCitations("s 6 of the Privacy Act 1988", noText);
    expect(b.status).toBe("in-force");
    expect(b.sections[0].status).toBe("unverified");
  });

  it("says not in this Act only when the Act's table of contents agrees", () => {
    // Listed in the contents but missed by the parser: a parse gap, not a missing section.
    expect(checkSection({ ...ACT, toc: ["6", "13", "14"] }, "14")).toMatchObject({ status: "unverified" });
    // No contents list at all: can't be sure.
    expect(checkSection({ ...ACT, toc: undefined }, "999")).toMatchObject({ status: "unverified" });
    expect(checkSection({ ...ACT, toc: [] }, "999")).toMatchObject({ status: "unverified" });
    // Missing from both: really not in this Act.
    expect(checkSection(ACT, "999")).toMatchObject({ status: "not-found" });
    // A partial contents list (it misses a section the parser found) is not trusted.
    expect(checkSection({ ...ACT, toc: ["6"] }, "999")).toMatchObject({ status: "unverified" });
    // Schedules are not numbered sections, so they do not count against the list.
    const withSchedule: ActText = {
      ...ACT,
      provisions: [...ACT.provisions, { no: "Schedule 1", heading: "Forms", context: "", body: "..." }],
    };
    expect(checkSection(withSchedule, "999")).toMatchObject({ status: "not-found" });
    // Number styles still match (non-breaking hyphen, "s" prefix).
    expect(checkSection({ ...ACT, toc: ["8-1"], provisions: [] }, "8‑1").status).toBe("unverified");
  });

  it("lists citations over the limit as not checked instead of dropping them", async () => {
    const many = Array.from({ length: 8 }, (_, i) => `s 1 of the Act Number${String.fromCharCode(65 + i)} Act 199${i}`).join(". ");
    const out = await verifyCitations(many, client());
    expect(out).toHaveLength(8);
    expect(out.slice(6).every((a) => a.status === "over-limit")).toBe(true);
  });

  it("stops when cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(verifyCitations("s 6 of the Privacy Act 1988", client(), controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("says couldn't check when the Act's text could not be split into sections", async () => {
    const [a] = await verifyCitations(
      "s 6 of the Privacy Act 1988",
      client({ loadAct: vi.fn(async () => ({ provisions: [], endnotes: "" })) }),
    );
    expect(a.sections[0].status).toBe("unverified");
  });

  it("leaves a section inside a Schedule unchecked", async () => {
    const [a] = await verifyCitations("s 18 of Sch 2 to the Privacy Act 1988", client());
    expect(a.sections).toEqual([
      { no: "18", status: "not-checked", note: "Cited as inside a Schedule; open the Act to check it." },
    ]);
  });

  it("returns nothing when no Act is cited", async () => {
    expect(await verifyCitations("Confidentiality lasts five years.", client())).toEqual([]);
  });
});

describe("attribution", () => {
  it("uses the register's required credit wording with the date", () => {
    expect(attribution(new Date(2026, 10, 20))).toBe(
      "Based on content from the Federal Register of Legislation at 20 November 2026. " +
        "For the latest information on Australian Government legislation please go to https://www.legislation.gov.au.",
    );
  });
});
