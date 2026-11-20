/**
 * ArkLaw is built for Australian lawyers. This is the one place that says which
 * country the add-in works in, which jurisdictions the lawyer can pick, and how a
 * jurisdiction is named to the AI, so nothing quietly falls back to US law.
 */

export const COUNTRY_CODE = "AU";
export const COUNTRY_NAME = "Australia";

/**
 * Governing-law choices. `value` is a short lowercase code stored in the
 * lawyer's settings; "" means Australia with no specific state or territory.
 */
export const AU_JURISDICTIONS: { value: string; label: string }[] = [
  { value: "", label: "Australia (no specific state)" },
  { value: "nsw", label: "New South Wales" },
  { value: "vic", label: "Victoria" },
  { value: "qld", label: "Queensland" },
  { value: "wa", label: "Western Australia" },
  { value: "sa", label: "South Australia" },
  { value: "tas", label: "Tasmania" },
  { value: "act", label: "Australian Capital Territory" },
  { value: "nt", label: "Northern Territory" },
];

/** True when `code` is one of the jurisdiction codes above ("" included). */
export function isJurisdictionCode(code: string): boolean {
  return AU_JURISDICTIONS.some((j) => j.value === code);
}

/** Words that all mean "Australia as a whole" when they reach a prompt. */
const NATIONAL = new Set(["", "au", "aus", "australia", "cth", "commonwealth", "federal"]);

/**
 * How a jurisdiction is named to the AI. A state or territory code becomes
 * "New South Wales, Australia"; blank, "AU", "cth" and similar become
 * "Australia". Anything else (for example "England and Wales", typed by the
 * lawyer) is passed through unchanged, so a deliberate choice is respected.
 */
export function lawName(code: string | null | undefined): string {
  const raw = (code ?? "").trim();
  const key = raw.toLowerCase();
  if (NATIONAL.has(key)) return COUNTRY_NAME;
  const hit = AU_JURISDICTIONS.find((j) => j.value !== "" && j.value === key);
  return hit ? `${hit.label}, ${COUNTRY_NAME}` : raw;
}
