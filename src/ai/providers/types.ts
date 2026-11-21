/**
 * Provider-agnostic chat interface.
 *
 * One shape for every provider so the rest of the community code never branches
 * on which vendor is active. OpenAI and Anthropic have bespoke adapters; Gemini,
 * Groq, Ollama, and Azure OpenAI all speak the OpenAI Chat Completions wire
 * format, so they share one adapter (`makeChatCompletions`) pointed at a
 * per-provider base URL. Ollama runs fully local (no key); Azure uses an
 * `api-key` header instead of a bearer token.
 */
export type ProviderId = "openai" | "anthropic" | "gemini" | "groq" | "ollama" | "azure";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * A file sent to the provider AS A FILE (not pre-extracted text): a PDF or an
 * image. Both OpenAI and Anthropic accept these natively and extract text +
 * page images themselves, which is the only way scanned PDFs work with no
 * backend. Office binaries (.docx/.doc) are NOT accepted by either provider, so
 * those are still extracted to text upstream and arrive as normal message text.
 * `dataBase64` is the raw file bytes, base64-encoded, with NO data: URI prefix
 * and no newlines. Attached to the LAST user message by each provider adapter.
 */
export interface ChatAttachment {
  name: string;
  /** MIME type, e.g. "application/pdf", "image/png". */
  mediaType: string;
  dataBase64: string;
}

export interface ChatRequest {
  /** System instruction. Sent as a system message (OpenAI) or the top-level
   *  `system` field (Anthropic). */
  system?: string;
  messages: ChatMessage[];
  /** Files (PDF / images) to attach to the last user message and send directly
   *  to the provider, which extracts their text + images itself. */
  attachments?: ChatAttachment[];
  /** Ask the model for a single JSON object (no prose, no code fences). */
  json?: boolean;
  /** Upper bound on output tokens. Required by Anthropic; omitted for OpenAI,
   *  whose default budget is large and whose param name varies by model. */
  maxTokens?: number;
  signal?: AbortSignal;
}

/**
 * Why the model stopped, normalised across providers. Only "complete" means the
 * model finished its answer on its own. Everything else means the text may be
 * cut off or missing, so callers that need a whole answer (a contract review)
 * must treat it as a failure, never as a short or empty result.
 * - truncated: hit the output-token limit (Anthropic max_tokens, OpenAI length)
 * - refused: the provider's safety layer declined (Anthropic refusal,
 *   OpenAI content_filter)
 * - incomplete: the stream ended without a stop reason, or stopped for a reason
 *   we do not handle (pause_turn, tool_use, unknown values)
 */
export type ChatFinish = "complete" | "truncated" | "refused" | "incomplete";

export interface ChatResult {
  text: string;
  /** Normalised stop reason. Adapters always set it. */
  finish: ChatFinish;
  /** The provider's raw stop reason, for error messages and logs (no content). */
  stopReason?: string | null;
}

/** Map an Anthropic Messages API stop_reason onto ChatFinish. */
export function anthropicFinish(stopReason: string | null | undefined): ChatFinish {
  if (stopReason === "end_turn" || stopReason === "stop_sequence") return "complete";
  if (stopReason === "max_tokens" || stopReason === "model_context_window_exceeded") return "truncated";
  if (stopReason === "refusal") return "refused";
  return "incomplete";
}

/** Map an OpenAI-compatible Chat Completions finish_reason onto ChatFinish. */
export function chatCompletionsFinish(finishReason: string | null | undefined): ChatFinish {
  if (finishReason === "stop") return "complete";
  if (finishReason === "length") return "truncated";
  if (finishReason === "content_filter") return "refused";
  return "incomplete";
}

export interface LlmProvider {
  id: ProviderId;
  chat(req: ChatRequest): Promise<ChatResult>;
  stream(req: ChatRequest, onDelta: (text: string) => void): Promise<ChatResult>;
}
