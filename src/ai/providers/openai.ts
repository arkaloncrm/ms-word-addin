import { ApiError } from "@/api/errors";
import { readSse } from "./sse";
import type { ChatAttachment, ChatRequest, LlmProvider, ProviderId } from "./types";
import { chatCompletionsFinish, isOutOfCredit, outOfCreditMessage, providerErrorMessage } from "./types";

/**
 * A single part of a multimodal Chat Completions message. Plain text messages
 * stay bare strings; a message with files becomes an array of these parts.
 */
type OpenAiPart =
  | { type: "text"; text: string }
  | { type: "file"; file: { filename: string; file_data: string } }
  | { type: "image_url"; image_url: { url: string } };

/**
 * Turn one attachment into its Chat Completions content part. PDFs use a `file`
 * part with an inline base64 data URI (Chat Completions requires base64, not a
 * detail flag); images use an `image_url` data URI. Office binaries are skipped
 * -- OpenAI does not accept them; their text was extracted upstream.
 */
function partFor(a: ChatAttachment): OpenAiPart | null {
  const dataUri = `data:${a.mediaType};base64,${a.dataBase64}`;
  if (a.mediaType === "application/pdf")
    return { type: "file", file: { filename: a.name || "document.pdf", file_data: dataUri } };
  if (a.mediaType.startsWith("image/")) return { type: "image_url", image_url: { url: dataUri } };
  return null;
}

/**
 * OpenAI adapter, browser-direct (BYOK). Uses the Chat Completions API.
 * The user's key is sent straight to api.openai.com and nowhere else.
 *
 * We deliberately do NOT send max_tokens or temperature: the param name and the
 * accepted temperature range differ across the current model families, and the
 * default budget is ample for our short structured prompts. Keeping the request
 * minimal avoids "unsupported parameter" rejections across models.
 */
const ENDPOINT = "https://api.openai.com/v1/chat/completions";

function mapError(brand: string, status: number, body: string): ApiError {
  // OpenAI reports no credit as HTTP 429 insufficient_quota: not a "wait a moment".
  if (isOutOfCredit(body)) return new ApiError("quota", status, outOfCreditMessage(brand), "OUT_OF_CREDIT");
  if (status === 401 || status === 403)
    return new ApiError(
      "unauthorized",
      401,
      `Your ${brand} API key was rejected. Check it in Settings.`,
      "INVALID_KEY",
    );
  if (status === 429)
    return new ApiError("rate_limited", 429, `${brand} rate-limited this request. Wait a moment and try again.`);
  if (status >= 500)
    return new ApiError("server", status, `${brand} is unavailable right now. Please try again.`);
  // The provider's sentence, never its raw JSON (or an HTML error page).
  const said = providerErrorMessage(body);
  return new ApiError(
    "invalid",
    status,
    said ? `${brand} rejected the request: ${said.slice(0, 300)}` : `${brand} rejected the request (error ${status}).`,
  );
}

function messagesFor(req: ChatRequest): { role: string; content: string | OpenAiPart[] }[] {
  const out: { role: string; content: string | OpenAiPart[] }[] = [];
  if (req.system) out.push({ role: "system", content: req.system });
  for (const m of req.messages) out.push({ role: m.role, content: m.content });

  // Attach files (PDF / images) to the LAST user message. The file part goes
  // first, then the instruction text, so the model has the document in view.
  const parts = (req.attachments ?? []).map(partFor).filter((p): p is OpenAiPart => p !== null);
  if (parts.length > 0) {
    for (let i = out.length - 1; i >= 0; i -= 1) {
      if (out[i].role !== "user") continue;
      const text = out[i].content as string;
      out[i] = { role: "user", content: [...parts, { type: "text", text }] };
      break;
    }
  }
  return out;
}

/**
 * Config for one OpenAI-compatible provider. The request/response wire format is
 * identical across OpenAI, Groq, Google Gemini's compat endpoint, Ollama, and
 * Azure OpenAI; only the endpoint, the auth header, and the brand name (for
 * error copy) differ.
 */
export interface ChatCompletionsConfig {
  id: ProviderId;
  /** User-facing name for error messages, e.g. "Groq", "Ollama". */
  brand: string;
  /** Full chat/completions URL. */
  endpoint: string;
  /** API key. May be empty for a local Ollama server (no auth). */
  apiKey: string;
  model: string;
  /** How the key is presented. Bearer for OpenAI/Groq/Gemini/Ollama; Azure uses
   *  an `api-key` header. Default "bearer". */
  auth?: "bearer" | "api-key";
}

/**
 * Build a provider that talks the OpenAI Chat Completions wire format at an
 * arbitrary endpoint. This is the shared engine behind OpenAI, Groq, Gemini,
 * Ollama, and Azure OpenAI. Browser-direct (BYOK): the key is sent only to the
 * endpoint the user configured.
 */
export function makeChatCompletions(cfg: ChatCompletionsConfig): LlmProvider {
  const { id, brand, endpoint, apiKey, model, auth = "bearer" } = cfg;

  function headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    // A local Ollama server needs no key; only attach auth when one is present.
    if (apiKey) {
      if (auth === "api-key") h["api-key"] = apiKey;
      else h.Authorization = `Bearer ${apiKey}`;
    }
    return h;
  }

  async function post(req: ChatRequest, stream: boolean): Promise<Response> {
    const body: Record<string, unknown> = { model, messages: messagesFor(req), stream };
    if (req.json) body.response_format = { type: "json_object" };
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new ApiError("network", 0, `Cannot reach ${brand}. Check your connection${id === "ollama" ? " and that the Ollama server is running" : ""}.`);
    }
    if (!res.ok) throw mapError(brand, res.status, await res.text().catch(() => ""));
    return res;
  }

  return {
    id,
    async chat(req) {
      const res = await post(req, false);
      const data = (await res.json()) as {
        choices?: { message?: { content?: string }; finish_reason?: string | null }[];
      };
      const finishReason = data.choices?.[0]?.finish_reason ?? null;
      return {
        text: data.choices?.[0]?.message?.content ?? "",
        finish: chatCompletionsFinish(finishReason),
        stopReason: finishReason,
      };
    },
    async stream(req, onDelta) {
      const res = await post(req, true);
      if (!res.body) throw new ApiError("server", res.status, `${brand} returned an empty stream.`);
      let full = "";
      // Null until a chunk carries finish_reason; a stream that ends without one
      // (dropped connection) is reported as incomplete.
      let finishReason: string | null = null;
      await readSse(res.body, (data) => {
        if (data === "[DONE]") return;
        let j: {
          choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
          error?: { message?: string };
        };
        try {
          j = JSON.parse(data);
        } catch {
          return; // Keepalive or partial frame; ignore.
        }
        if (j.error) {
          if (isOutOfCredit(j.error.message ?? "")) throw new ApiError("quota", 0, outOfCreditMessage(brand), "OUT_OF_CREDIT");
          throw new ApiError("invalid", 0, `${brand} stopped the answer part-way: ${j.error.message ?? "unknown error"}.`);
        }
        const piece = j.choices?.[0]?.delta?.content;
        if (piece) {
          full += piece;
          onDelta(piece);
        }
        const fr = j.choices?.[0]?.finish_reason;
        if (fr) finishReason = fr;
      });
      return { text: full, finish: chatCompletionsFinish(finishReason), stopReason: finishReason };
    },
  };
}

/** OpenAI itself: the compat engine pointed at api.openai.com. */
export function makeOpenAI(apiKey: string, model: string): LlmProvider {
  return makeChatCompletions({ id: "openai", brand: "OpenAI", endpoint: ENDPOINT, apiKey, model });
}
