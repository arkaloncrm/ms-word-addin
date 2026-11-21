// runJson: the shared JSON runner. A cut-off, refused or unfinished answer is
// always an error; strict callers (the contract review) never get `{}` back.
import { describe, expect, it, vi } from "vitest";
import type { ChatFinish, ChatRequest, LlmProvider } from "@/ai/providers/types";
import { DEFAULT_JSON_MAX_TOKENS, IncompleteAnswerError, runJson } from "./llm";

function fakeProvider(answers: { text: string; finish: ChatFinish }[]) {
  const calls: ChatRequest[] = [];
  const provider: LlmProvider = {
    id: "anthropic",
    chat: vi.fn(),
    async stream(req) {
      calls.push(req);
      const a = answers.shift();
      if (!a) throw new Error("no more answers");
      return { ...a, stopReason: a.finish };
    },
  };
  return { provider, calls };
}

describe("runJson", () => {
  it("returns the parsed answer when the model finished", async () => {
    const { provider, calls } = fakeProvider([{ text: '{"ok": true}', finish: "complete" }]);
    await expect(runJson("sys", "user", { provider })).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ json: true, maxTokens: DEFAULT_JSON_MAX_TOKENS, system: "sys" });
  });

  it("passes a caller's larger output budget through", async () => {
    const { provider, calls } = fakeProvider([{ text: "{}", finish: "complete" }]);
    await runJson("s", "u", { provider, maxTokens: 32_000 });
    expect(calls[0].maxTokens).toBe(32_000);
  });

  it.each(["truncated", "refused", "incomplete"] as const)(
    "throws for a %s answer, in strict AND lenient mode, even if the text parses",
    async (finish) => {
      for (const strict of [true, false]) {
        // A truncated answer can still contain a parseable object (or be cut at
        // a point where "{...}" extraction succeeds): it must not be used.
        const { provider, calls } = fakeProvider([{ text: '{"redlines": []}', finish }]);
        const p = runJson("s", "u", { provider, strict });
        await expect(p).rejects.toBeInstanceOf(IncompleteAnswerError);
        await expect(p).rejects.toMatchObject({ finish });
        expect(calls).toHaveLength(1); // not silently re-billed
      }
    },
  );

  it("retries once when the finished answer is unreadable, then uses the retry", async () => {
    const { provider, calls } = fakeProvider([
      { text: "Sure! Here you go", finish: "complete" },
      { text: '{"ok": 1}', finish: "complete" },
    ]);
    await expect(runJson("s", "u", { provider, strict: true })).resolves.toEqual({ ok: 1 });
    expect(calls).toHaveLength(2);
    expect(calls[1].messages[0].content).toContain("Return ONLY a single valid JSON value");
  });

  it("strict mode throws when the answer is unreadable twice; it never returns {}", async () => {
    const { provider } = fakeProvider([
      { text: "nope", finish: "complete" },
      { text: "still nope", finish: "complete" },
    ]);
    const p = runJson("s", "u", { provider, strict: true });
    await expect(p).rejects.toBeInstanceOf(IncompleteAnswerError);
    await expect(p).rejects.toMatchObject({ finish: "unreadable" });
  });

  it("lenient mode keeps the old {} fallback for an unreadable (but finished) answer", async () => {
    const { provider } = fakeProvider([
      { text: "nope", finish: "complete" },
      { text: "still nope", finish: "complete" },
    ]);
    await expect(runJson("s", "u", { provider })).resolves.toEqual({});
  });

  it("explains each failure in plain words", () => {
    expect(new IncompleteAnswerError("truncated").message).toContain("cut off");
    expect(new IncompleteAnswerError("refused").message).toContain("declined");
    expect(new IncompleteAnswerError("incomplete", "pause_turn").message).toContain("(pause_turn)");
    expect(new IncompleteAnswerError("unreadable").message).toContain("could not be read");
  });
});
