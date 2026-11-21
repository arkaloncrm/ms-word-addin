// Every adapter reports WHY the model stopped, so a cut-off, refused or
// dropped answer is never mistaken for a finished one.
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAX_TOKENS, makeAnthropic } from "./anthropic";
import { makeChatCompletions } from "./openai";
import { anthropicFinish, chatCompletionsFinish } from "./types";

function sse(frames: unknown[]): Response {
  const text = frames.map((f) => `data: ${typeof f === "string" ? f : JSON.stringify(f)}\n\n`).join("");
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const bodies: Record<string, unknown>[] = [];
function mockFetch(res: () => Response) {
  bodies.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return res();
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

const req = { system: "s", messages: [{ role: "user" as const, content: "u" }] };

describe("stop reason mapping", () => {
  it("Anthropic", () => {
    expect(anthropicFinish("end_turn")).toBe("complete");
    expect(anthropicFinish("stop_sequence")).toBe("complete");
    expect(anthropicFinish("max_tokens")).toBe("truncated");
    expect(anthropicFinish("model_context_window_exceeded")).toBe("truncated");
    expect(anthropicFinish("refusal")).toBe("refused");
    expect(anthropicFinish("pause_turn")).toBe("incomplete");
    expect(anthropicFinish("tool_use")).toBe("incomplete");
    expect(anthropicFinish(null)).toBe("incomplete");
    expect(anthropicFinish(undefined)).toBe("incomplete");
  });

  it("OpenAI-compatible (OpenAI, Groq, Gemini, Ollama, Azure)", () => {
    expect(chatCompletionsFinish("stop")).toBe("complete");
    expect(chatCompletionsFinish("length")).toBe("truncated");
    expect(chatCompletionsFinish("content_filter")).toBe("refused");
    expect(chatCompletionsFinish("tool_calls")).toBe("incomplete");
    expect(chatCompletionsFinish(null)).toBe("incomplete");
  });
});

describe("Anthropic adapter", () => {
  const anthropic = () => makeAnthropic("test-key", "claude-test");
  const delta = (text: string) => ({ type: "content_block_delta", delta: { type: "text_delta", text } });

  it("streams a finished answer as complete", async () => {
    mockFetch(() =>
      sse([
        { type: "message_start" },
        delta('{"a"'),
        delta(": 1}"),
        { type: "message_delta", delta: { stop_reason: "end_turn" } },
        { type: "message_stop" },
      ]),
    );
    const pieces: string[] = [];
    const res = await anthropic().stream(req, (t) => pieces.push(t));
    expect(res).toEqual({ text: '{"a": 1}', finish: "complete", stopReason: "end_turn" });
    expect(pieces).toEqual(['{"a"', ": 1}"]);
  });

  it("reports an answer cut off at max_tokens as truncated", async () => {
    mockFetch(() => sse([delta('{"redlines": ['), { type: "message_delta", delta: { stop_reason: "max_tokens" } }]));
    const res = await anthropic().stream(req, () => {});
    expect(res.finish).toBe("truncated");
  });

  it("reports a stream that ends without a stop reason as incomplete", async () => {
    mockFetch(() => sse([delta("partial answer")]));
    const res = await anthropic().stream(req, () => {});
    expect(res.finish).toBe("incomplete");
    expect(res.stopReason).toBeNull();
  });

  it("throws on an error event mid-stream instead of returning a shorter answer", async () => {
    mockFetch(() =>
      sse([delta("partial"), { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }]),
    );
    await expect(anthropic().stream(req, () => {})).rejects.toThrow(/overloaded/i);
  });

  it("reads the stop reason on a non-streamed answer too", async () => {
    mockFetch(() => Response.json({ content: [{ type: "text", text: "no" }], stop_reason: "refusal" }));
    const res = await anthropic().chat(req);
    expect(res).toEqual({ text: "no", finish: "refused", stopReason: "refusal" });
  });

  it("leaves room for thinking + answer when the caller sets no budget", async () => {
    mockFetch(() => Response.json({ content: [], stop_reason: "end_turn" }));
    await anthropic().chat(req);
    expect(bodies[0].max_tokens).toBe(DEFAULT_MAX_TOKENS);
    expect(DEFAULT_MAX_TOKENS).toBeGreaterThanOrEqual(16_000);
  });

  it("sends the caller's budget when set", async () => {
    mockFetch(() => Response.json({ content: [], stop_reason: "end_turn" }));
    await anthropic().chat({ ...req, maxTokens: 32_000 });
    expect(bodies[0].max_tokens).toBe(32_000);
  });
});

describe("OpenAI-compatible adapter", () => {
  const openai = () =>
    makeChatCompletions({ id: "openai", brand: "OpenAI", endpoint: "https://example.test/v1/chat/completions", apiKey: "k", model: "m" });
  const chunk = (content?: string, finish_reason: string | null = null) => ({
    choices: [{ delta: content ? { content } : {}, finish_reason }],
  });

  it("streams a finished answer as complete", async () => {
    mockFetch(() => sse([chunk("{}"), chunk(undefined, "stop"), "[DONE]"]));
    expect(await openai().stream(req, () => {})).toEqual({ text: "{}", finish: "complete", stopReason: "stop" });
  });

  it("reports a length stop as truncated", async () => {
    mockFetch(() => sse([chunk('{"a":'), chunk(undefined, "length"), "[DONE]"]));
    expect((await openai().stream(req, () => {})).finish).toBe("truncated");
  });

  it("reports a stream with no finish reason as incomplete", async () => {
    mockFetch(() => sse([chunk("half")]));
    expect((await openai().stream(req, () => {})).finish).toBe("incomplete");
  });

  it("throws on an error frame mid-stream", async () => {
    mockFetch(() => sse([chunk("half"), { error: { message: "server_error" } }]));
    await expect(openai().stream(req, () => {})).rejects.toThrow(/stopped the answer part-way/);
  });

  it("reads content_filter on a non-streamed answer as refused", async () => {
    mockFetch(() => Response.json({ choices: [{ message: { content: "" }, finish_reason: "content_filter" }] }));
    expect((await openai().chat(req)).finish).toBe("refused");
  });
});
