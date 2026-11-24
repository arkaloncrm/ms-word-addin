/**
 * Hand an Ask-mode request over to the Edit flow.
 *
 * The Edit flow reads only the document and an instruction, so a request like
 * "yes, can you insert this into the text" means nothing on its own: "this" is
 * the wording ArkLaw proposed in its last answer. These builders turn the chat
 * into a self-contained instruction for the edit model, and keep a short label
 * for the transcript so the lawyer sees what they typed, not the whole prompt.
 */

/** The smallest message shape the builders need (an AssistantMessage fits). */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** An Edit-flow request: what the model is told, and what the lawyer sees. */
export interface EditHandoff {
  instruction: string;
  display: string;
}

/** Longest earlier answer passed through as the proposal to apply. */
const PROPOSAL_MAX = 12_000;
/** Longest earlier answer passed through as background context. */
const CONTEXT_MAX = 4_000;
/** Longest earlier question passed through. */
const QUESTION_MAX = 1_500;

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max)} [cut]`;
}

/** The last assistant answer with text, and the question that produced it. */
export function lastExchange(
  messages: readonly ChatTurn[],
): { question: string; answer: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "assistant" || !m.content.trim()) continue;
    const prev = messages
      .slice(0, i)
      .reverse()
      .find((p) => p.role === "user");
    return { question: prev?.content ?? "", answer: m.content };
  }
  return null;
}

/** The standing rule for every handoff: contract wording only, never chat. */
const WORDING_ONLY =
  "Use only proposed contract wording. Never put commentary, explanations, questions, notes or headings like \"Proposed clause\" into the document. " +
  "Locate each change in the clause it belongs to, and give each change, including consequential amendments, as its own edit.";

/**
 * "Apply what you proposed": the earlier answer IS the instruction. Used for
 * "insert this" follow-ups and for the Turn into changes button on an answer.
 */
export function proposalHandoff(
  request: string,
  exchange: { question: string; answer: string },
): EditHandoff {
  const asked = exchange.question.trim()
    ? `The lawyer asked in chat: "${clip(exchange.question, QUESTION_MAX)}"\n`
    : "";
  const instruction =
    `${asked}ArkLaw proposed this in its answer:\n"""\n${clip(exchange.answer, PROPOSAL_MAX)}\n"""\n` +
    `Now the lawyer says: "${request.trim()}"\n` +
    `Turn the contract wording proposed in that answer into edits to the document. ${WORDING_ONLY}`;
  return { instruction, display: request.trim() };
}

/**
 * A fresh edit request typed in Ask mode. The recent chat travels along as
 * background, so "suggest one and insert it" knows what "one" refers to.
 */
export function requestHandoff(
  request: string,
  exchange: { question: string; answer: string } | null,
): EditHandoff {
  const text = request.trim();
  if (!exchange) return { instruction: text, display: text };
  const instruction =
    `${text}\n\n` +
    `Recent conversation, for context only (do not copy its commentary into the document):\n` +
    (exchange.question.trim() ? `Lawyer: ${clip(exchange.question, QUESTION_MAX)}\n` : "") +
    `ArkLaw: ${clip(exchange.answer, CONTEXT_MAX)}\n\n${WORDING_ONLY}`;
  return { instruction, display: text };
}
