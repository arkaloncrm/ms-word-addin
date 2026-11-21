import { getProvider } from "@/ai/providers/registry";
import type { ChatFinish, LlmProvider } from "@/ai/providers/types";

/**
 * Shared JSON-mode runner for the community shim. Used by both the JSON request
 * router and the multipart form router. Tolerates a model that wraps its JSON in
 * prose or code fences by extracting the outermost object/array.
 *
 * FAIL-SAFE RULES (see IncompleteAnswerError):
 * - An answer that was cut off (output-token limit), refused, or ended without
 *   a stop reason is ALWAYS an error, in every mode. A truncated JSON object can
 *   still parse (or be "recovered" into {}), and an empty object looks like a
 *   clean result, so it must never reach a caller as data.
 * - strict mode (contract review): an answer that is complete but unreadable
 *   after one retry is also an error, never `{}`.
 * - lenient mode (the smaller tools): unreadable-after-retry still falls back
 *   to `{}`, as before, because those callers render their own empty states.
 */

/** Default output budget: thinking + answer on current Claude models. */
export const DEFAULT_JSON_MAX_TOKENS = 16_000;

/**
 * The AI's answer did not finish, so it cannot be trusted as a result. The
 * message is written for the lawyer; `finish` says why (for tests and logs).
 */
export class IncompleteAnswerError extends Error {
  readonly finish: ChatFinish | "unreadable";
  constructor(finish: ChatFinish | "unreadable", stopReason?: string | null) {
    super(incompleteMessage(finish, stopReason));
    this.name = "IncompleteAnswerError";
    this.finish = finish;
  }
}

function incompleteMessage(finish: ChatFinish | "unreadable", stopReason?: string | null): string {
  switch (finish) {
    case "truncated":
      return "The AI's answer was cut off before it finished (it reached its length limit), so ArkLaw has not used it. Please try again.";
    case "refused":
      return "The AI declined to answer this request, so ArkLaw has no result to show. Please try again or rephrase.";
    case "unreadable":
      return "The AI's answer could not be read, so ArkLaw has not used it. Please try again.";
    default:
      return `The AI's answer stopped before it finished${stopReason ? ` (${stopReason})` : ""}, so ArkLaw has not used it. Please try again.`;
  }
}

/**
 * Parse the model's text into JSON, tolerating prose or code-fence wrapping by
 * extracting the outermost object/array. Returns `undefined` when nothing
 * parses, so callers can distinguish a hard parse failure from a genuinely
 * empty `{}` and decide whether to retry.
 */
function tryParseJson(text: string): unknown | undefined {
  const attempt = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };
  const direct = attempt(text);
  if (direct !== undefined) return direct;
  const obj = text.indexOf("{");
  const objEnd = text.lastIndexOf("}");
  if (obj !== -1 && objEnd > obj) {
    const v = attempt(text.slice(obj, objEnd + 1));
    if (v !== undefined) return v;
  }
  const arr = text.indexOf("[");
  const arrEnd = text.lastIndexOf("]");
  if (arr !== -1 && arrEnd > arr) {
    const v = attempt(text.slice(arr, arrEnd + 1));
    if (v !== undefined) return v;
  }
  return undefined;
}

/**
 * Lenient parse for callers that always want an object back: returns `{}` when
 * nothing parses so a downstream shape access never throws.
 */
export function parseJson(text: string): unknown {
  return tryParseJson(text) ?? {};
}

export interface RunJsonOptions {
  /** Output-token budget. Default DEFAULT_JSON_MAX_TOKENS. */
  maxTokens?: number;
  /** Throw instead of returning `{}` when the answer is unreadable. */
  strict?: boolean;
  /** Use this provider instead of the user's saved one (tests, eval). */
  provider?: LlmProvider;
  signal?: AbortSignal;
}

/**
 * One JSON-mode call. Streams (so a long answer is not killed by an idle
 * connection) and returns the text only when the model finished on its own.
 */
async function jsonText(system: string, user: string, opts: RunJsonOptions): Promise<string> {
  const provider = opts.provider ?? getProvider();
  const res = await provider.stream(
    {
      system,
      messages: [{ role: "user", content: user }],
      json: true,
      maxTokens: opts.maxTokens ?? DEFAULT_JSON_MAX_TOKENS,
      signal: opts.signal,
    },
    () => {},
  );
  if (res.finish !== "complete") throw new IncompleteAnswerError(res.finish, res.stopReason);
  return res.text;
}

/**
 * Run a JSON-mode completion and return the parsed value. If the model emits
 * unparseable output (stray prose, a stray code fence), retry once with a
 * firmer instruction. After that: strict callers get IncompleteAnswerError,
 * lenient callers get `{}`. A cut-off, refused or unfinished answer throws in
 * both modes (never retried here: the caller shows the error and the lawyer
 * chooses to try again, so a failing request is not silently billed twice).
 */
export async function runJson(system: string, user: string, opts: RunJsonOptions = {}): Promise<unknown> {
  const first = tryParseJson(await jsonText(system, user, opts));
  if (first !== undefined) return first;
  const retry = tryParseJson(
    await jsonText(
      system,
      `${user}\n\nReturn ONLY a single valid JSON value. No prose, no markdown, no code fences.`,
      opts,
    ),
  );
  if (retry !== undefined) return retry;
  if (opts.strict) throw new IncompleteAnswerError("unreadable");
  return {};
}
