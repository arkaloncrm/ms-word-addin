/**
 * Contracting parties as the contract itself names them ("Acme Pty Ltd",
 * "Jordan Lee"), with each one's role ("Discloser", "Employer"). Review shows
 * these real names and asks which one the lawyer acts for, instead of a generic
 * side like "Customer" that may not match the contract at all.
 */
export interface ContractParty {
  name: string;
  role: string;
}

/** More than this is almost always a misread (signatories, witnesses, schedules). */
export const MAX_PARTIES = 4;

/** Longer than this is a sentence, not a party name. */
const MAX_NAME_CHARS = 120;

function clean(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

/**
 * Tidy the AI's party list: keep only entries with a name, trim spacing, drop
 * repeats (case-insensitive), and keep at most MAX_PARTIES. Anything that is not
 * a list returns an empty list, so a classifier that omits parties (or the
 * hosted backend, which never sends them) simply shows no party picker.
 */
export function normalizeParties(raw: unknown): ContractParty[] {
  if (!Array.isArray(raw)) return [];
  const out: ContractParty[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = clean(o.name);
    if (!name || name.length > MAX_NAME_CHARS) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, role: clean(o.role) });
    if (out.length >= MAX_PARTIES) break;
  }
  return out;
}

/** The side text the reviewer AI is given: the party's own name, plus its role when known. */
export function partySide(p: ContractParty): string {
  return p.role ? `${p.name} (${p.role})` : p.name;
}
