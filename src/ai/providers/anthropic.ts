import { ApiError } from "@/api/errors";
import { readSse } from "./sse";
import { anthropicFinish, isOutOfCredit, outOfCreditMessage, providerErrorMessage } from "./types";
import type { ChatAttachment, ChatRequest, LlmProvider } from "./types";

/**
 * A single block of Anthropic message content. When a message carries files it
 * becomes an array of these; a plain text message stays a bare string.
 */
type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "document"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

/**
 * Turn one attachment into its Anthropic content block. PDFs use a `document`
 * block; images use an `image` block. Anything else (an Office binary that
 * slipped through) is skipped -- the provider does not accept it, and its text
 * was already extracted upstream.
 */
function blockFor(a: ChatAttachment): AnthropicBlock | null {
  const source = { type: "base64" as const, media_type: a.mediaType, data: a.dataBase64 };
  if (a.mediaType === "application/pdf") return { type: "document", source };
  if (a.mediaType.startsWith("image/")) return { type: "image", source };
  return null;
}

/**
 * Anthropic adapter, browser-direct (BYOK).
 *
 * The Messages API allows browser calls when the caller opts in with the
 * `anthropic-dangerous-direct-browser-access` header. That is the sanctioned
 * pattern for a bring-your-own-key tool: the key belongs to the user and is sent
 * only to api.anthropic.com. `system` is a top-level field (not a message), and
 * max_tokens is required.
 */
const ENDPOINT = "https://api.anthropic.com/v1/messages";
const VERSION = "2023-06-01";
/** Output budget when the caller does not set one (thinking + answer). */
export const DEFAULT_MAX_TOKENS = 16_000;

function mapError(status: number, body: string): ApiError {
  if (isOutOfCredit(body)) return new ApiError("quota", status, outOfCreditMessage("Anthropic"), "OUT_OF_CREDIT");
  if (status === 401)
    return new ApiError(
      "unauthorized",
      401,
      "Your Anthropic API key was rejected. Check it in Settings.",
      "INVALID_KEY",
    );
  if (status === 429)
    return new ApiError("rate_limited", 429, "Anthropic rate-limited this request. Wait a moment and try again.");
  if (status >= 500)
    return new ApiError("server", status, "Anthropic is unavailable right now. Please try again.");
  // The provider's sentence, never its raw JSON (or an HTML error page).
  const said = providerErrorMessage(body);
  return new ApiError(
    "invalid",
    status,
    said ? `Anthropic rejected the request: ${said.slice(0, 300)}` : `Anthropic rejected the request (error ${status}).`,
  );
}

function bodyFor(req: ChatRequest, model: string, stream: boolean): Record<string, unknown> {
  const messages: { role: string; content: string | AnthropicBlock[] }[] = req.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

  // Attach files (PDF / images) to the LAST user message, before its text, so
  // the model reads the document and then the instruction. Docs must precede the
  // prose per Anthropic's guidance for best grounding.
  const blocks = (req.attachments ?? []).map(blockFor).filter((b): b is AnthropicBlock => b !== null);
  if (blocks.length > 0) {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role !== "user") continue;
      const text = messages[i].content as string;
      messages[i] = { role: "user", content: [...blocks, { type: "text", text }] };
      break;
    }
  }

  let system = req.system;
  if (req.json) {
    system = `${system ?? ""}\n\nRespond with only a single valid JSON object. No prose, no markdown code fences.`.trim();
  }
  // Current Claude models think before answering, and that thinking counts
  // against max_tokens, so the default must leave room for both.
  const body: Record<string, unknown> = { model, max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS, messages, stream };
  if (system) body.system = system;
  return body;
}

export function makeAnthropic(apiKey: string, model: string): LlmProvider {
  async function post(req: ChatRequest, stream: boolean): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": VERSION,
          "anthropic-dangerous-direct-browser-access": "true",
          "content-type": "application/json",
        },
        body: JSON.stringify(bodyFor(req, model, stream)),
        signal: req.signal,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new ApiError("network", 0, "Cannot reach Anthropic. Check your connection.");
    }
    if (!res.ok) throw mapError(res.status, await res.text().catch(() => ""));
    return res;
  }

  return {
    id: "anthropic",
    async chat(req) {
      const res = await post(req, false);
      const data = (await res.json()) as {
        content?: { type?: string; text?: string }[];
        stop_reason?: string | null;
      };
      const text = (data.content ?? [])
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text as string)
        .join("");
      return { text, finish: anthropicFinish(data.stop_reason), stopReason: data.stop_reason ?? null };
    },
    async stream(req, onDelta) {
      const res = await post(req, true);
      if (!res.body) throw new ApiError("server", res.status, "Anthropic returned an empty stream.");
      let full = "";
      // Stays null unless a message_delta carries a stop_reason. A stream that
      // ends without one (dropped connection) is reported as incomplete.
      let stopReason: string | null = null;
      await readSse(res.body, (data) => {
        let j: {
          type?: string;
          delta?: { type?: string; text?: string; stop_reason?: string | null };
          error?: { type?: string; message?: string };
        };
        try {
          j = JSON.parse(data);
        } catch {
          return; // Non-JSON frame (keepalive); ignore.
        }
        if (j.type === "content_block_delta" && j.delta?.type === "text_delta" && j.delta.text) {
          full += j.delta.text;
          onDelta(j.delta.text);
        } else if (j.type === "message_delta" && j.delta?.stop_reason) {
          stopReason = j.delta.stop_reason;
        } else if (j.type === "error") {
          // An error mid-stream (for example "overloaded") ends the answer early.
          // It must surface as a failure, never as a shorter answer.
          if (isOutOfCredit(j.error?.message ?? ""))
            throw new ApiError("quota", 0, outOfCreditMessage("Anthropic"), "OUT_OF_CREDIT");
          const overloaded = j.error?.type === "overloaded_error";
          throw new ApiError(
            overloaded ? "server" : "invalid",
            overloaded ? 529 : 0,
            overloaded
              ? "Anthropic is overloaded right now, so the answer stopped part-way. Please try again."
              : `Anthropic stopped the answer part-way: ${(j.error?.message ?? "unknown error").slice(0, 300)}.`,
          );
        }
      });
      return { text: full, finish: anthropicFinish(stopReason), stopReason };
    },
  };
}
