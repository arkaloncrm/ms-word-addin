/**
 * Workspace preferences store for the add-in (the single source of truth for
 * the user's standing context).
 *
 * Holds the user's DEFAULT matter (grounding workspace; "" when none), DEFAULT
 * jurisdiction (an Australian state or territory code such as "nsw" / "vic", or
 * "" for Australia as a whole; see src/lib/region.ts) and DEFAULT contract type
 * (an enum value such as "nda"; "" means unset). The user sets these ONCE in Settings; Review and the Assistant read
 * matter + jurisdiction from here instead of re-asking on every run.
 *
 * Mirrors the pattern in ./org.ts: a single in-memory value, persisted in
 * add-in-origin localStorage (sandboxed, does NOT travel with the .docx), with
 * get / set / subscribe and a startup init. Values are treated immutably; set()
 * builds a new object rather than mutating the current one.
 */
import { isJurisdictionCode } from "./region";

const STORAGE_KEY = "vaquill.reviewPrefs";

export interface ReviewPrefs {
  /** Matter id to ground new work in, or "" for none. */
  matterId: string;
  /** Australian state or territory code (e.g. "nsw") or "" for Australia. */
  jurisdiction: string;
  /** Contract-type enum value (e.g. "nda") or "" when unset. */
  contractType: string;
}

type Listener = (prefs: ReviewPrefs) => void;

const DEFAULT_PREFS: ReviewPrefs = { matterId: "", jurisdiction: "", contractType: "" };

let prefs: ReviewPrefs = DEFAULT_PREFS;
const listeners = new Set<Listener>();

/** Exported for tests. Cleans whatever was stored by this or an older build. */
export function sanitizeReviewPrefs(raw: unknown): ReviewPrefs {
  if (!raw || typeof raw !== "object") return DEFAULT_PREFS;
  const obj = raw as Record<string, unknown>;
  // Jurisdiction codes are lowercase. A code that is not an Australian state or
  // territory (for example "ca" or "ny" saved by the US build this add-in was
  // forked from) falls back to "" (Australia), never to a US state.
  const code = typeof obj.jurisdiction === "string" ? obj.jurisdiction.trim().toLowerCase() : "";
  return {
    matterId: typeof obj.matterId === "string" ? obj.matterId : "",
    jurisdiction: isJurisdictionCode(code) ? code : "",
    contractType: typeof obj.contractType === "string" ? obj.contractType : "",
  };
}

/** Read the persisted preferences once at startup. */
export function initReviewPrefs(): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    prefs = stored ? sanitizeReviewPrefs(JSON.parse(stored)) : DEFAULT_PREFS;
  } catch {
    prefs = DEFAULT_PREFS;
  }
}

export function getReviewPrefs(): ReviewPrefs {
  return prefs;
}

/** Merge a partial update, persist, and notify subscribers. No-op if unchanged. */
export function setReviewPrefs(update: Partial<ReviewPrefs>): void {
  const next: ReviewPrefs = { ...prefs, ...update };
  if (
    next.matterId === prefs.matterId &&
    next.jurisdiction === prefs.jurisdiction &&
    next.contractType === prefs.contractType
  ) {
    return;
  }
  prefs = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable (private mode / policy) -- keep it in memory.
  }
  for (const l of listeners) l(next);
}

export function subscribeReviewPrefs(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
