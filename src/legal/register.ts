/**
 * The live register client ArkLaw uses: the Federal Register of Legislation API
 * (src/legal/frl.ts) plus parsing an Act's epub into sections and reading its
 * table of contents, with a small cache so the same Act is downloaded once per
 * session.
 */
import * as frl from "./frl";
import { epubDocuments, parseAct, tocSectionNumbers, type ActText } from "./actText";
import type { RegisterClient } from "./verify";

// Keyed by register id: one id names one unchanging compilation.
const acts = new Map<string, Promise<ActText>>();
const MAX_CACHED = 4;
/** The whole download of one Act, headers and body. */
const DOWNLOAD_LIMIT_MS = 60_000;

/**
 * Wait for `work`, but stop waiting (with an AbortError) when `signal` is
 * cancelled. The work itself carries on, because another lookup may be sharing
 * it; one caller's cancel must not fail someone else's check.
 */
export function untilCancelled<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(frl.abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(frl.abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

function loadAct(version: frl.Version, signal?: AbortSignal): Promise<ActText> {
  let loading = acts.get(version.registerId);
  if (!loading) {
    // Shared by every caller, so started without any one caller's signal. Its
    // size is capped (frl.MAX_EPUB_BYTES), it has its own time limit so a
    // stalled download cannot sit in the cache, and the result is kept for reuse.
    const limit = new AbortController();
    const timer = setTimeout(() => limit.abort(), DOWNLOAD_LIMIT_MS);
    loading = frl
      .getEpub(version.titleId, limit.signal)
      .then((epub) => epubDocuments(epub))
      .then((docs) => ({ ...parseAct(docs), toc: tocSectionNumbers(docs) }))
      .finally(() => clearTimeout(timer));
    acts.set(version.registerId, loading);
    // A failed download must not stay cached.
    loading.catch(() => acts.delete(version.registerId));
    while (acts.size > MAX_CACHED) {
      const oldest = acts.keys().next().value;
      if (oldest === undefined) break;
      acts.delete(oldest);
    }
  }
  return untilCancelled(loading, signal);
}

export const register: RegisterClient = {
  searchTitles: (query, searchType, match, top, signal) => frl.searchTitles(query, searchType, match, top, signal),
  findVersion: (titleId, signal) => frl.findVersion(titleId, signal),
  loadAct,
  webLink: frl.webLink,
};
