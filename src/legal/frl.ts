// Adapted from australian-law-mcp (https://github.com/ChangkeunJ/australian-law-mcp,
// src/frl.ts at commit 96318e4), Copyright (c) 2026 ChangkeunJ, MIT licence: see
// LICENSE-australian-law-mcp.txt in this folder. Changed for ArkLaw: runs in the
// Word task pane (browser fetch, so no user-agent header and a shorter timeout),
// keeps only the calls ArkLaw uses, and refuses an Act file too large to open in
// the pane.
//
// Client for the Federal Register of Legislation OData API.
// No auth, no key. Content is CC BY 4.0: https://www.legislation.gov.au/terms-of-use
// The API allows calls from ArkLaw's web address (checked 20 Nov 2026).
//
// Quirks confirmed by probing the live API (2026-08-20, by the original author):
// - datetime function parameters must omit the trailing Z or the server
//   rejects them with an ODataException
// - documents/find treats uniqueTypeNumber/volumeNumber/rectificationVersionNumber
//   as mandatory even though the swagger marks them optional; volumeNumber=0
//   returns the complete document even for multi-volume acts
// - the text() search criteria needs the undocumented 3-argument form
//   text("query",searchType,matchType); the 1-argument form matches names only
// - enum-valued fields come back as their number from Versions/Find(asAt=...)
//   and as their name from Versions/Find(asAtSpecification='Latest'), so both
//   have to be accepted

const BASE = 'https://api.prod.legislation.gov.au/v1';
const TIMEOUT_MS = 20_000;
/** An Act file bigger than this is not opened in the Word pane. */
export const MAX_EPUB_BYTES = 25_000_000;

export class FrlError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'FrlError';
    this.status = status;
  }
}

export interface StatusEntry {
  status: string;
  start: string;
}

export interface Title {
  id: string;
  name: string;
  collection: string;
  status: string;
  isPrincipal: boolean;
  isInForce: boolean;
  year?: number | null;
  statusHistory?: StatusEntry[];
}

export interface Version {
  titleId: string;
  name: string;
  status: string;
  start: string;
  end?: string | null;
  registerId: string;
  compilationNumber?: string | null;
  hasUnincorporatedAmendments?: boolean;
}

export interface SearchResult {
  count: number;
  titles: Title[];
}

const cache = new Map<string, { at: number; value: unknown }>();
const HOUR = 3_600_000;

function remember<T>(key: string, value: T): T {
  if (cache.size > 200) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function request(path: string, signal?: AbortSignal): Promise<Response> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw abortError();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    // ArkLaw: the caller's cancel stops the request, including reading its body.
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await fetch(BASE + path, { signal: controller.signal });
      if (res.status >= 500) {
        signal?.removeEventListener('abort', onAbort);
        last = new FrlError(`FRL API responded ${res.status}`, res.status);
        continue;
      }
      return res;
    } catch (e) {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) throw abortError();
      last = e;
      // A request that ran out of time will run out of time again.
      if (e instanceof Error && e.name === 'AbortError') break;
    } finally {
      clearTimeout(timer);
    }
  }
  const reason = last instanceof Error ? last.message : String(last);
  throw new FrlError(`could not reach the Federal Register of Legislation (${reason})`);
}

/** The error a cancelled request rejects with (name "AbortError"). */
export function abortError(): Error {
  const e = new Error('cancelled');
  e.name = 'AbortError';
  return e;
}

async function getJson<T>(path: string, ttl: number, signal?: AbortSignal): Promise<T> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const res = await request(path, signal);
  if (!res.ok) throw new FrlError(`FRL API responded ${res.status}`, res.status);
  return remember(path, (await res.json()) as T);
}

export function quoted(value: string): string {
  const out = value.replace(/'/g, "''").replace(/"/g, '');
  if (out.trim() === '') throw new FrlError('the search query is empty once quoting characters are removed');
  return out;
}

// Title ids sit in the URL path, so a stray %, # or ? would truncate or
// corrupt the request rather than produce a clean "no such title".
export function pathId(titleId: string): string {
  if (!/^[A-Za-z0-9]+$/.test(titleId)) {
    throw new FrlError(`"${titleId}" is not a register title id (letters and digits only, e.g. C2004A03348)`);
  }
  return titleId;
}

// Member order is the enum's, from the service $metadata.
const STATUS = ['InForce', 'Ceased', 'Repealed', 'NeverEffective'];

function named(members: string[], value: unknown): string {
  if (typeof value === 'number') return members[value] ?? String(value);
  return typeof value === 'string' ? value : '';
}

function nameTitleEnums<T extends Title>(title: T): T {
  title.status = named(STATUS, title.status);
  for (const entry of title.statusHistory ?? []) entry.status = named(STATUS, entry.status);
  return title;
}

export type SearchType = 'name' | 'nameAndText' | 'id';
export type MatchType = 'exact' | 'all' | 'any' | 'contains' | 'excludes' | 'startswith';

interface ODataList<T> {
  '@odata.count'?: number;
  value: T[];
}

/** The register path for a title search. Exported for tests. */
export function searchPath(query: string, searchType: SearchType, match: MatchType, top = 10): string {
  const criteria = encodeURIComponent(`text("${quoted(query)}",${searchType},${match})`);
  return `/titles/search(criteria='${criteria}')?$top=${Math.min(top, 100)}&$count=true`;
}

export async function searchTitles(
  query: string,
  searchType: SearchType,
  match: MatchType,
  top = 10,
  signal?: AbortSignal,
): Promise<SearchResult> {
  const data = await getJson<ODataList<Title>>(searchPath(query, searchType, match, top), HOUR, signal);
  return { count: data['@odata.count'] ?? data.value.length, titles: data.value.map(nameTitleEnums) };
}

/** The latest compilation of a title, or null when the register has none. */
export async function findVersion(titleId: string, signal?: AbortSignal): Promise<Version | null> {
  try {
    const v = await getJson<Version>(
      `/Versions/Find(titleId='${pathId(titleId)}',asAtSpecification='Latest')`,
      HOUR,
      signal,
    );
    v.status = named(STATUS, v.status);
    return v;
  } catch (e) {
    if (e instanceof FrlError && e.status === 404) return null;
    throw e;
  }
}

/** The latest compilation of a title as an epub file. */
export async function getEpub(titleId: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const path =
    `/documents/find(titleid='${pathId(titleId)}',asatspecification='Latest',type='Primary',` +
    `format='Epub',uniqueTypeNumber=0,volumeNumber=0,rectificationVersionNumber=0)`;
  const res = await request(path, signal);
  if (!res.ok) throw new FrlError(`FRL API responded ${res.status} for the ${titleId} document`, res.status);
  const tooLarge = () => new FrlError('this Act is too large to open in the Word pane; read it on the register');
  const size = Number(res.headers.get('content-length') ?? 0);
  if (size > MAX_EPUB_BYTES) throw tooLarge();
  return readCapped(res, MAX_EPUB_BYTES, tooLarge);
}

/**
 * Read a response body, stopping once it passes `max` bytes, so a missing or
 * wrong content-length cannot make the pane download an unbounded file.
 */
export async function readCapped(res: Response, max: number, tooLarge: () => Error): Promise<ArrayBuffer> {
  if (!res.body) {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > max) throw tooLarge();
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out.buffer;
}

/** The register's web page for a title. */
export function webLink(titleId: string): string {
  return `https://www.legislation.gov.au/${titleId}/latest/text`;
}
