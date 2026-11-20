/**
 * Laws and standards the whole-document compliance check offers, Australian
 * first. In ArkLaw the check runs on the lawyer's own AI key (see
 * src/community/localRouter.ts), which is told the full name and the blurb
 * through regulationForPrompt, not just the short value.
 */
export interface RegulationOption {
  value: string;
  label: string;
  /** One-line, lawyer-plain description shown under the picker. */
  blurb: string;
}

export const REGULATIONS: RegulationOption[] = [
  {
    value: "au_privacy",
    label: "Privacy Act 1988 (Cth)",
    blurb: "Australian Privacy Principles: collection, use, disclosure, overseas transfers, and notifiable data breaches.",
  },
  {
    value: "au_consumer_law",
    label: "Australian Consumer Law",
    blurb: "Unfair contract terms in standard form contracts, consumer guarantees, and misleading conduct.",
  },
  {
    value: "au_spam",
    label: "Spam Act 2003 (Cth)",
    blurb: "Commercial emails and SMS: consent, sender identification, and a working unsubscribe.",
  },
  {
    value: "au_modern_slavery",
    label: "Modern Slavery Act 2018 (Cth)",
    blurb: "Modern slavery risks in operations and supply chains, and supplier obligations that support reporting.",
  },
  {
    value: "au_fair_work",
    label: "Fair Work Act 2009 (Cth)",
    blurb: "National Employment Standards, modern awards, and minimum employment terms.",
  },
  {
    value: "au_soci",
    label: "Security of Critical Infrastructure Act 2018 (Cth)",
    blurb: "Critical infrastructure assets: risk management, incident reporting, and data obligations.",
  },
  {
    value: "au_aml_ctf",
    label: "AML/CTF Act 2006 (Cth)",
    blurb: "Anti-money laundering: customer due diligence, reporting, and record-keeping for reporting entities.",
  },
  { value: "gdpr", label: "GDPR", blurb: "EU data protection: lawful basis, data-subject rights, transfers." },
  { value: "pci_dss", label: "PCI DSS", blurb: "Payment-card data: storage, transmission, and security controls." },
  { value: "soc2", label: "SOC 2", blurb: "Security, availability, and confidentiality trust-service criteria." },
];

export function regulationLabel(value: string): string {
  return REGULATIONS.find((r) => r.value === value)?.label ?? value.toUpperCase();
}

/**
 * What the AI is told to check against: the full name plus what it covers, so
 * a short value like "au_privacy" is never left for the model to guess.
 */
export function regulationForPrompt(value: string): string {
  const r = REGULATIONS.find((x) => x.value === value);
  return r ? `${r.label} (${r.blurb})` : value;
}

/**
 * Distinctive vocabulary per regulation, for a fast client-side "which regulation
 * is this document about" heuristic. `strong` phrases are near-unambiguous when
 * present (2 pts); `weak` single terms are supporting signals (1 pt). Regulations
 * have such distinct language (personal information vs cardholder data vs modern awards) that a
 * keyword pass is enough to pick a smart default the user can still change - no
 * LLM call needed here (unlike contract-type detection).
 */
const REGULATION_SIGNALS: { value: string; strong: string[]; weak: string[] }[] = [
  {
    value: "au_privacy",
    strong: [
      "privacy act 1988",
      "australian privacy principle",
      "notifiable data breach",
      "eligible data breach",
      "information commissioner",
    ],
    weak: ["personal information", "sensitive information", "privacy act"],
  },
  {
    value: "au_consumer_law",
    strong: [
      "australian consumer law",
      "competition and consumer act",
      "unfair contract term",
      "consumer guarantee",
      "standard form contract",
    ],
    weak: ["misleading or deceptive", "small business contract"],
  },
  {
    value: "au_spam",
    strong: ["spam act", "commercial electronic message", "unsubscribe facility"],
    weak: ["unsubscribe", "marketing email"],
  },
  {
    value: "au_modern_slavery",
    strong: ["modern slavery", "forced labour", "child labour", "human trafficking"],
    weak: ["supply chain", "ethical sourcing"],
  },
  {
    value: "au_fair_work",
    strong: [
      "fair work act",
      "national employment standards",
      "modern award",
      "enterprise agreement",
      "fair work commission",
    ],
    weak: ["annual leave", "personal leave", "superannuation", "probation"],
  },
  {
    value: "au_soci",
    strong: [
      "security of critical infrastructure",
      "critical infrastructure asset",
      "critical infrastructure risk management",
      "soci act",
    ],
    weak: ["critical infrastructure"],
  },
  {
    value: "au_aml_ctf",
    strong: [
      "anti-money laundering",
      "counter-terrorism financing",
      "aml/ctf",
      "austrac",
      "customer due diligence",
    ],
    weak: ["money laundering", "know your customer"],
  },
  {
    value: "pci_dss",
    strong: ["cardholder data", "primary account number", "pci dss", "pci-dss"],
    weak: ["cardholder", "payment card", "card data"],
  },
  {
    value: "gdpr",
    strong: [
      "general data protection regulation",
      "gdpr",
      "data subject",
      "lawful basis",
      "data protection officer",
      "supervisory authority",
    ],
    weak: ["personal data", "european union"],
  },
  {
    value: "soc2",
    strong: [
      "soc 2",
      "soc2",
      "trust service criteria",
      "service organization control",
      "service organisation control",
    ],
    weak: [],
  },
];

/**
 * Best-guess the relevant regulation from document text. Returns a regulation
 * value only when a distinctive signal is present AND there is a clear leader,
 * so an ambiguous document yields null and the caller keeps its default rather
 * than pre-selecting the wrong regulation.
 */
export function suggestRegulation(text: string): string | null {
  const hay = (text || "").toLowerCase();
  let best: { value: string; score: number } | null = null;
  let second = 0;
  for (const sig of REGULATION_SIGNALS) {
    let score = 0;
    for (const s of sig.strong) if (hay.includes(s)) score += 2;
    for (const w of sig.weak) if (hay.includes(w)) score += 1;
    if (!best || score > best.score) {
      second = best?.score ?? 0;
      best = { value: sig.value, score };
    } else if (score > second) {
      second = score;
    }
  }
  // Confident only: at least one distinctive signal, and a clear lead.
  if (best && best.score >= 2 && best.score > second) return best.value;
  return null;
}
