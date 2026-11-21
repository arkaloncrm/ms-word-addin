// When the AI provider turns a request down, the lawyer sees a plain sentence,
// never the provider's raw JSON. Seen in Word on 21 Nov 2026: an account with no
// credit left showed {"type":"error","error":{...}} inside the review message.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, errorMessage } from "@/api/errors";
import { reviewFailureMessage } from "@/community/reviewStream";
import { makeAnthropic } from "./anthropic";
import { makeChatCompletions } from "./openai";
import { isOutOfCredit, providerErrorMessage } from "./types";

const ANTHROPIC_NO_CREDIT = JSON.stringify({
  type: "error",
  error: {
    type: "invalid_request_error",
    message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
  },
  request_id: "req_test",
});
const OPENAI_NO_QUOTA = JSON.stringify({
  error: {
    message: "You exceeded your current quota, please check your plan and billing details.",
    type: "insufficient_quota",
    code: "insufficient_quota",
  },
});

function reply(status: number, body: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status })),
  );
}
function sse(frames: unknown[]): void {
  const text = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } })),
  );
}

afterEach(() => vi.unstubAllGlobals());

const req = { system: "s", messages: [{ role: "user" as const, content: "u" }] };
const anthropic = () => makeAnthropic("test-key", "claude-test");
const openai = () =>
  makeChatCompletions({ id: "openai", brand: "OpenAI", endpoint: "https://example.test/v1/chat/completions", apiKey: "k", model: "m" });

async function failure(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error("expected the call to fail");
}

describe("helpers", () => {
  it("reads the provider's own message from a JSON error body", () => {
    expect(providerErrorMessage(ANTHROPIC_NO_CREDIT)).toMatch(/^Your credit balance is too low/);
    expect(providerErrorMessage(OPENAI_NO_QUOTA)).toMatch(/^You exceeded your current quota/);
    expect(providerErrorMessage("<html>Bad gateway</html>")).toBeNull();
    expect(providerErrorMessage("")).toBeNull();
  });

  it("recognises an account with no credit left", () => {
    expect(isOutOfCredit(ANTHROPIC_NO_CREDIT)).toBe(true);
    expect(isOutOfCredit(OPENAI_NO_QUOTA)).toBe(true);
    expect(isOutOfCredit('{"error":{"message":"max_tokens: must be at most 64000"}}')).toBe(false);
  });
});

describe("Anthropic: out of credit", () => {
  it("before the answer starts: a plain message, never JSON", async () => {
    reply(400, ANTHROPIC_NO_CREDIT);
    const e = await failure(anthropic().stream(req, () => {}));
    expect(e.code).toBe("OUT_OF_CREDIT");
    const shown = errorMessage(e);
    expect(shown).toContain("run out of credit");
    expect(shown).toContain("ask whoever gave you the key");
    expect(shown).not.toContain("{");
  });

  it("part-way through a streamed answer", async () => {
    sse([{ type: "message_start" }, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }]);
    const e = await failure(anthropic().stream(req, () => {}));
    expect(e.code).toBe("OUT_OF_CREDIT");
  });

  it("the review message says so plainly and still marks nothing as reviewed", async () => {
    reply(400, ANTHROPIC_NO_CREDIT);
    const msg = reviewFailureMessage(await failure(anthropic().stream(req, () => {})));
    expect(msg).toMatch(/^Review not completed\. Anthropic says the account behind this key has run out of credit/);
    expect(msg).toContain("Nothing has been marked as reviewed or clean.");
    expect(msg).not.toContain("{");
  });
});

describe("Anthropic: other rejections", () => {
  it("shows the provider's sentence, not its JSON", async () => {
    reply(400, JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "max_tokens: must be at most 64000" } }));
    const e = await failure(anthropic().chat(req));
    expect(errorMessage(e)).toBe("Anthropic rejected the request: max_tokens: must be at most 64000");
  });

  it("a body that isn't JSON is not shown at all", async () => {
    reply(400, "<html><body>Bad request</body></html>");
    const e = await failure(anthropic().chat(req));
    expect(errorMessage(e)).toBe("Anthropic rejected the request (error 400).");
  });

  it("a long message part-way through an answer is cut to a readable length", async () => {
    sse([{ type: "message_start" }, { type: "error", error: { type: "api_error", message: "x".repeat(5000) } }]);
    const e = await failure(anthropic().stream(req, () => {}));
    expect(errorMessage(e).length).toBeLessThan(400);
  });

  it("a wrong key still says so", async () => {
    reply(401, JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }));
    const e = await failure(anthropic().chat(req));
    expect(e.code).toBe("INVALID_KEY");
  });
});

describe("OpenAI-compatible: out of credit", () => {
  it("insufficient_quota (HTTP 429) is out of credit, not 'wait a moment'", async () => {
    reply(429, OPENAI_NO_QUOTA);
    const e = await failure(openai().stream(req, () => {}));
    expect(e.code).toBe("OUT_OF_CREDIT");
    expect(errorMessage(e)).toContain("OpenAI says the account behind this key has run out of credit");
  });

  it("a real rate limit still says wait a moment", async () => {
    reply(429, JSON.stringify({ error: { message: "Rate limit reached", type: "requests" } }));
    const e = await failure(openai().chat(req));
    expect(e.kind).toBe("rate_limited");
  });

  it("other rejections show the provider's sentence, not its JSON", async () => {
    reply(400, JSON.stringify({ error: { message: "Unsupported parameter: 'temperature'" } }));
    const e = await failure(openai().chat(req));
    expect(errorMessage(e)).toBe("OpenAI rejected the request: Unsupported parameter: 'temperature'");
  });
});
