import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { parseCitations } from "./cite";
import { epubDocuments, parseAct, findProvision, tocSectionNumbers } from "./actText";
import { pathId, quoted, readCapped, searchPath, webLink } from "./frl";
import { officialTextFor } from "./officialText";
import { untilCancelled } from "./register";
import type { RegisterClient } from "./verify";

describe("parseCitations (ArkLaw's jurisdiction tag)", () => {
  it("keeps the jurisdiction written after the Act", () => {
    const [cth, nsw] = parseCitations("s 6 of the Privacy Act 1988 (Cth) and s 5B of the Civil Liability Act 2002 (NSW)");
    expect(cth).toEqual({ act: "Privacy Act 1988", sections: ["6"], jurisdiction: "Cth" });
    expect(nsw).toEqual({ act: "Civil Liability Act 2002", sections: ["5B"], jurisdiction: "NSW" });
  });

  it("leaves it out when none is written", () => {
    expect(parseCitations("s 181 of the Corporations Act 2001")).toEqual([{ act: "Corporations Act 2001", sections: ["181"] }]);
  });
});

describe("frl helpers", () => {
  it("builds the register's title search", () => {
    expect(searchPath("Privacy Act 1988", "name", "exact", 25)).toBe(
      "/titles/search(criteria='" + encodeURIComponent('text("Privacy Act 1988",name,exact)') + "')?$top=25&$count=true",
    );
  });
  it("escapes quotes and refuses odd title ids", () => {
    expect(quoted(`O'Brien "Act"`)).toBe("O''Brien Act");
    expect(() => pathId("C2004A03712/../x")).toThrow();
    expect(pathId("C2004A03712")).toBe("C2004A03712");
    expect(webLink("C2004A03712")).toBe("https://www.legislation.gov.au/C2004A03712/latest/text");
  });
});

describe("untilCancelled", () => {
  it("stops waiting on cancel without failing the shared work", async () => {
    let finish: (v: string) => void = () => {};
    const shared = new Promise<string>((r) => (finish = r));
    const controller = new AbortController();
    const mine = untilCancelled(shared, controller.signal);
    const theirs = untilCancelled(shared);
    controller.abort();
    await expect(mine).rejects.toMatchObject({ name: "AbortError" });
    finish("act");
    await expect(theirs).resolves.toBe("act");
  });
});

describe("tocSectionNumbers", () => {
  it("reads section numbers from the Act's table of contents", () => {
    const html =
      '<p class="TOC2"><span>Part 1—Preliminary</span></p>' +
      '<p class="TOC5"><span>1  Short title</span></p>' +
      '<p class="TOC5"><span>8‑1  General deductions</span></p>' +
      '<p class="ActHead5"><span class="CharSectno">1</span> Short title</p>';
    expect(tocSectionNumbers(html)).toEqual(["1", "8-1"]);
  });
});

describe("readCapped", () => {
  const big = () => new Error("too large");
  it("reads a body under the cap", async () => {
    const buf = await readCapped(new Response(new Uint8Array([1, 2, 3])), 10, big);
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3]));
  });
  it("stops once the body passes the cap, whatever the headers say", async () => {
    await expect(readCapped(new Response(new Uint8Array(20)), 10, big)).rejects.toThrow("too large");
  });
});

describe("epubDocuments", () => {
  it("reads the register's document files in order from the epub", async () => {
    const zip = new JSZip();
    zip.file("OEBPS/document_2/document_2.html", '<p class="ActHead5"><span class="CharSectno">2</span> Second</p><p>Two.</p>');
    zip.file("OEBPS/document_1/document_1.html", '<p class="ActHead5"><span class="CharSectno">1</span> First</p><p>One.</p>');
    zip.file("OEBPS/other.html", "<p>ignore</p>");
    const docs = await epubDocuments(await zip.generateAsync({ type: "uint8array" }));
    expect(docs).toHaveLength(2);
    const act = parseAct(docs);
    expect(findProvision(act, "1")?.body).toBe("One.");
    expect(findProvision(act, "2")?.heading).toBe("Second");
  });

  it("refuses a file with no register documents", async () => {
    const zip = new JSZip();
    zip.file("readme.txt", "x");
    await expect(epubDocuments(await zip.generateAsync({ type: "uint8array" }))).rejects.toThrow();
  });
});

describe("officialTextFor", () => {
  const found: RegisterClient = {
    searchTitles: vi.fn(async () => ({
      count: 1,
      titles: [{ id: "C2004A03712", name: "Privacy Act 1988", collection: "Act", status: "InForce", isPrincipal: true, isInForce: true }],
    })),
    findVersion: vi.fn(async () => ({ titleId: "C2004A03712", name: "Privacy Act 1988", status: "InForce", start: "", registerId: "R1" })),
    loadAct: vi.fn(async () => ({ provisions: [{ no: "6", heading: "Interpretation", context: "", body: "In this Act ..." }], endnotes: "" })),
    webLink: (id: string) => id,
  };

  it("gives the AI the official text of a section the question names", async () => {
    const out = await officialTextFor("Does s 6 of the Privacy Act 1988 define personal information?", found);
    expect(out).toContain("Official text from the Federal Register of Legislation");
    expect(out).toContain("quote from this text, not from memory");
    expect(out).toContain("[Privacy Act 1988 (Cth) s 6 Interpretation]\nIn this Act ...");
  });

  it("does nothing for a question without a section, or a state Act", async () => {
    expect(await officialTextFor("What is a good confidentiality period?", found)).toBe("");
    expect(await officialTextFor("Does s 5B of the Civil Liability Act 2002 (NSW) apply?", found)).toBe("");
  });

  it("gives up quietly when the register is slow, and stops its lookups", async () => {
    let seen: AbortSignal | undefined;
    const slow: RegisterClient = {
      ...found,
      searchTitles: (_q, _t, _m, _top, signal) => {
        seen = signal;
        return new Promise(() => {});
      },
    };
    expect(await officialTextFor("s 6 of the Privacy Act 1988", slow, { timeoutMs: 20 })).toBe("");
    expect(seen?.aborted).toBe(true);
  });

  it("stops at once when the lawyer cancels", async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const slow: RegisterClient = {
      ...found,
      searchTitles: (_q, _t, _m, _top, signal) => {
        seen = signal;
        return new Promise(() => {});
      },
    };
    const pending = officialTextFor("s 6 of the Privacy Act 1988", slow, { signal: controller.signal, timeoutMs: 60_000 });
    controller.abort();
    expect(await pending).toBe("");
    expect(seen?.aborted).toBe(true);
    // Already cancelled: no lookup at all.
    const calls = vi.fn(found.searchTitles);
    expect(await officialTextFor("s 6 of the Privacy Act 1988", { ...found, searchTitles: calls }, { signal: controller.signal })).toBe("");
    expect(calls).not.toHaveBeenCalled();
  });
});
