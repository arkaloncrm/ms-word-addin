// Ask never hides a cut: a document too long to read in full, and an answer
// that was cut off, refused or dropped, both get a visible note.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatFinish } from "@/ai/providers/types";

const stream = vi.fn();
vi.mock("@/ai/providers/registry", () => ({ getProvider: () => ({ id: "anthropic", chat: vi.fn(), stream }) }));
vi.mock("@/legal/officialText", () => ({ officialTextFor: async () => "" }));

import { ASK_MAX_TOKENS, askEndNote, communityStream } from "./localStream";
import { ASK_CONTEXT_MAX_CHARS, askDocumentNote, assistantSystem } from "@/ai/prompts";

afterEach(() => stream.mockReset());

async function ask(context: string, finish: ChatFinish) {
  stream.mockImplementation(async (_req: unknown, onDelta: (t: string) => void) => {
    onDelta("The answer.");
    return { text: "The answer.", finish, stopReason: null };
  });
  const chunks: string[] = [];
  const events: string[] = [];
  await communityStream(
    "/api/v1/stream/chat",
    { messages: [{ role: "user", content: "What does clause 4.2 say?" }], context },
    {
      onEvent: ({ event, data }: { event: string; data: string }) => {
        events.push(event);
        if (event === "chunk") chunks.push(JSON.parse(data).content);
      },
    } as never,
  );
  return { text: chunks.join(""), events };
}

describe("Ask notes", () => {
  it("adds nothing to a finished answer about a document read in full", async () => {
    const { text, events } = await ask("Short contract.", "complete");
    expect(text).toBe("The answer.");
    expect(events.at(-1)).toBe("done");
    expect(stream.mock.calls[0][0].maxTokens).toBe(ASK_MAX_TOKENS);
  });

  it.each([
    ["truncated", "cut off because it reached the length limit"],
    ["refused", "declined to answer"],
    ["incomplete", "stopped before it finished"],
  ] as const)("marks a %s answer visibly", async (finish, words) => {
    const { text } = await ask("Short contract.", finish);
    expect(text.startsWith("The answer.")).toBe(true);
    expect(text).toContain(words);
    expect(askEndNote(finish)).toContain(words);
  });

  it("says up front when the document was too long to read in full", async () => {
    const long = "x".repeat(ASK_CONTEXT_MAX_CHARS * 2);
    const { text } = await ask(long, "complete");
    expect(text.startsWith("**Note: this document is too long for Ask to read in full.**")).toBe(true);
    expect(text).toContain("first 50% of it only");
    // The model is told too, so it can say when a later part might matter.
    expect(assistantSystem(long)).toContain("too long to include in full");
  });

  it("adds no note for a document exactly at the limit", () => {
    expect(askDocumentNote("x".repeat(ASK_CONTEXT_MAX_CHARS))).toBe("");
    expect(askDocumentNote("")).toBe("");
  });
});
