/**
 * Turn the AI's "Draft here" answer into clean paragraphs for the contract.
 * Pure, so it is tested without Word or a model.
 *
 * Guards against the mistakes seen in other tools' demos: the heading repeated
 * as the first line, markdown, and notes to the lawyer left inside the drafted
 * text ("[Note: ...]", "Drafting note: ..."). Those notes move to `notes`, which
 * the panel shows and never inserts.
 */
import { clauseName } from "./target";

export interface DraftHereResult {
  /** Paragraphs to insert, in order. Empty when the model returned nothing usable. */
  blocks: string[];
  /** Things for the lawyer to check; shown in the panel, never inserted. */
  notes: string | null;
}

const MAX_BLOCKS = 40;
const META_LINE = /^\s*\[?\s*(?:note|notes|drafting note|drafter'?s note|ai note|comment)\s*[:\-]/i;
const BRACKET_NOTE = /\[\s*(?:note|drafting note|draft)\s*:[^\]]*\]/gi;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Remove markdown emphasis, heading marks and list bullets the model may add. */
function plain(line: string): string {
  return line
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*\*/g, "")
    // __emphasis__ only: a run of underscores inside brackets is a blank to fill.
    .replace(/(^|\s)__([^_\s][^_]*?)__(?=$|\s|[.,;:])/g, "$1$2")
    .replace(/`/g, "")
    .replace(/^>\s*/, "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*•]\s+/, "")
    .trim();
}

export function shapeDraftHere(raw: unknown, heading: string): DraftHereResult {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const notes: string[] = [];
  const modelNotes = str(o.notes).trim();
  if (modelNotes) notes.push(modelNotes);

  let lines = str(o.text)
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map(plain)
    .filter(Boolean);

  // Notes to the lawyer never go into the contract. One pass, so the notes keep
  // the order they appeared in.
  const kept: string[] = [];
  for (const l of lines) {
    if (META_LINE.test(l)) {
      notes.push(l.replace(/^\s*\[|\]\s*$/g, "").trim());
      continue;
    }
    const found = l.match(BRACKET_NOTE);
    if (found) notes.push(...found.map((n) => n.replace(/^\[|\]$/g, "").trim()));
    const cleaned = l.replace(BRACKET_NOTE, "").replace(/\s{2,}/g, " ").trim();
    if (cleaned) kept.push(cleaned);
  }
  lines = kept;

  // Do not repeat the heading the lawyer already typed.
  const want = clauseName(heading).toLowerCase();
  if (want && lines.length) {
    const first = lines[0];
    if (clauseName(first).toLowerCase() === want) {
      lines.shift();
    } else {
      const prefix = new RegExp(`^(?:\\d+(?:\\.\\d+)*\\.?\\s+)?${escapeRe(clauseName(heading))}\\s*[.:\\-–]\\s+`, "i");
      if (prefix.test(first)) lines[0] = first.replace(prefix, "");
    }
  }

  return {
    blocks: lines.slice(0, MAX_BLOCKS),
    notes: notes.length ? notes.join(" ") : null,
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
