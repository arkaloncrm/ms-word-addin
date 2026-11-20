/**
 * Check the Acts and sections an AI answer cites against the Federal Register
 * of Legislation (Commonwealth law). Based on the verify_citations tool in
 * australian-law-mcp (MIT, see LICENSE-australian-law-mcp.txt), rebuilt for
 * ArkLaw's panel with stricter rules on what may be called "not found":
 *
 *  - A state Act ("(NSW)" etc.) is never looked up on the Commonwealth register.
 *  - An Act whose name only roughly matches a register title is shown as the
 *    closest match, and its sections are NOT checked against it.
 *  - A section is "not in this Act" only when it is missing from BOTH the parsed
 *    sections and the Act's own table of contents. A section listed in the
 *    contents but not parsed, an Act with no contents list, a register outage
 *    or a failed download is "couldn't confirm", never "not found".
 *  - Citations over the limit are listed as not checked, not dropped.
 */
import { parseCitations, type Citation } from "./cite";
import { findProvision, normaliseSectionNo, type ActText } from "./actText";
import { abortError, type SearchResult, type Title, type Version } from "./frl";

export type ActStatus = "in-force" | "not-in-force" | "no-match" | "state-law" | "unverified" | "over-limit";
export type SectionStatus = "found" | "not-found" | "unverified" | "not-checked";

export interface SectionCheck {
  no: string;
  status: SectionStatus;
  heading?: string;
  /** The section's text from the register, when found. */
  body?: string;
  /** Plain words for the lawyer when the status needs explaining. */
  note?: string;
}

export interface ActCheck {
  /** The Act as the answer named it. */
  cited: string;
  jurisdiction?: string;
  status: ActStatus;
  titleId?: string;
  /** The register's own name for the title. */
  name?: string;
  link?: string;
  /** True when the register's title is only the closest match to the cited name. */
  closest?: boolean;
  /** The register status when not in force, e.g. "Repealed". */
  registerStatus?: string;
  sections: SectionCheck[];
}

/** What verify needs from the register; the real one is in register.ts. */
export interface RegisterClient {
  searchTitles(
    query: string,
    searchType: "name",
    match: "exact" | "all",
    top: number,
    signal?: AbortSignal,
  ): Promise<SearchResult>;
  findVersion(titleId: string, signal?: AbortSignal): Promise<Version | null>;
  loadAct(version: Version, signal?: AbortSignal): Promise<ActText>;
  webLink(titleId: string): string;
}

const MAX_ACTS = 6;
const MAX_SECTIONS = 8;
const MAX_BODY = 8_000;
const OVER_LIMIT = "Not checked: too many in one answer.";

function norm(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

/** Find the register title for a cited Act name, exact match first. */
async function resolveTitle(
  client: RegisterClient,
  act: string,
  signal?: AbortSignal,
): Promise<{ title: Title | null; closest: boolean }> {
  const wanted = norm(act);
  // An exact-phrase search also returns instruments made under the Act
  // ("Competition and Consumer Act 2010 - Declaration No. 94"), sometimes ahead
  // of the Act itself (seen live, 20 Nov 2026), so look well down the list.
  let found = await client.searchTitles(act, "name", "exact", 25, signal);
  let exact = found.titles.find((t) => norm(t.name) === wanted);
  if (exact) return { title: exact, closest: false };
  if (found.titles.length === 0) {
    found = await client.searchTitles(act, "name", "all", 25, signal);
    exact = found.titles.find((t) => norm(t.name) === wanted);
    if (exact) return { title: exact, closest: false };
  }
  const first = found.titles[0] ?? null;
  return { title: first, closest: first !== null };
}

/** Decide one cited section against the parsed Act and its table of contents. */
export function checkSection(act: ActText, no: string): SectionCheck {
  const p = findProvision(act, no);
  if (p) {
    return {
      no,
      status: "found",
      heading: p.heading,
      body: p.body.length > MAX_BODY ? `${p.body.slice(0, MAX_BODY)}…` : p.body,
    };
  }
  const toc = act.toc ?? [];
  const want = normaliseSectionNo(no);
  // Trust the contents list only if it is complete: every numbered section the
  // parser found must be listed in it. A partial list (only some sections, or
  // only Parts) could otherwise "confirm" a real section as missing.
  const parsed = act.provisions.map((p) => normaliseSectionNo(p.no)).filter((n) => !n.startsWith("SCHEDULE"));
  const tocComplete = toc.length > 0 && parsed.length > 0 && parsed.every((n) => toc.includes(n));
  if (tocComplete && !toc.includes(want)) {
    return { no, status: "not-found", note: `This Act's current version has no section ${no}.` };
  }
  return {
    no,
    status: "unverified",
    note: "Couldn't confirm this section in the Act's text here; open the Act to check it.",
  };
}

async function checkOne(client: RegisterClient, c: Citation, signal?: AbortSignal): Promise<ActCheck> {
  const sections = c.sections.slice(0, MAX_SECTIONS);
  const extra = c.sections.slice(MAX_SECTIONS).map((no): SectionCheck => ({ no, status: "not-checked", note: OVER_LIMIT }));
  const base: ActCheck = { cited: c.act, jurisdiction: c.jurisdiction, status: "unverified", sections: [] };

  if (c.jurisdiction && c.jurisdiction !== "Cth") {
    return {
      ...base,
      status: "state-law",
      sections: c.sections.map((no) => ({ no, status: "not-checked", note: "State laws are not checked yet." })),
    };
  }

  let resolved: { title: Title | null; closest: boolean };
  try {
    resolved = await resolveTitle(client, c.act, signal);
  } catch (e) {
    if (isAbort(e)) throw e;
    return {
      ...base,
      sections: [...sections.map((no) => ({ no, status: "unverified" as const, note: errorText(e) })), ...extra],
    };
  }
  const { title, closest } = resolved;
  if (!title) {
    return {
      ...base,
      status: "no-match",
      sections: c.sections.map((no) => ({ no, status: "not-checked" as const })),
    };
  }

  const check: ActCheck = {
    ...base,
    status: title.isInForce ? "in-force" : "not-in-force",
    titleId: title.id,
    name: title.name,
    link: client.webLink(title.id),
    closest,
    registerStatus: title.isInForce ? undefined : title.status,
    sections: [],
  };
  const scheduled = (c.scheduled ?? []).map(
    (no): SectionCheck => ({ no, status: "not-checked", note: "Cited as inside a Schedule; open the Act to check it." }),
  );

  if (sections.length === 0) {
    check.sections = [...extra, ...scheduled];
    return check;
  }

  if (closest) {
    // Checking sections against a different Act could report a real one missing.
    check.sections = [
      ...sections.map((no) => ({
        no,
        status: "not-checked" as const,
        note: "The Act's name did not match a register title exactly, so its sections were not checked.",
      })),
      ...extra,
      ...scheduled,
    ];
    return check;
  }

  try {
    const version = await client.findVersion(title.id, signal);
    if (!version) throw new Error("the register has no current version of this Act");
    const act = await client.loadAct(version, signal);
    if (act.provisions.length === 0) {
      throw new Error("the Act's text could not be split into sections here");
    }
    check.sections = [...sections.map((no) => checkSection(act, no)), ...extra, ...scheduled];
  } catch (e) {
    if (isAbort(e)) throw e;
    check.sections = [
      ...sections.map((no) => ({ no, status: "unverified" as const, note: errorText(e) })),
      ...extra,
      ...scheduled,
    ];
  }
  return check;
}

/**
 * Check every Act cited in `text`, in the order they appear: the first 6 against
 * the register, any more listed as not checked. Rejects with an AbortError if
 * `signal` is cancelled.
 */
export async function verifyCitations(text: string, client: RegisterClient, signal?: AbortSignal): Promise<ActCheck[]> {
  const citations = parseCitations(text);
  const out: ActCheck[] = [];
  // One Act at a time: polite to the register, and the cache serves repeats.
  for (const c of citations.slice(0, MAX_ACTS)) {
    if (signal?.aborted) throw abortError();
    out.push(await checkOne(client, c, signal));
  }
  for (const c of citations.slice(MAX_ACTS)) {
    out.push({
      cited: c.act,
      jurisdiction: c.jurisdiction,
      status: "over-limit",
      sections: c.sections.map((no) => ({ no, status: "not-checked", note: OVER_LIMIT })),
    });
  }
  return out;
}

/** The register's required credit line, with the date the text was fetched. */
export function attribution(date = new Date()): string {
  const when = date.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
  return (
    `Based on content from the Federal Register of Legislation at ${when}. ` +
    "For the latest information on Australian Government legislation please go to https://www.legislation.gov.au."
  );
}
