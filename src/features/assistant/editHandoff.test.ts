import { describe, expect, it } from "vitest";
import { lastExchange, proposalHandoff, requestHandoff } from "./editHandoff";

const chat = [
  { role: "user" as const, content: "Rewrite 9.1 to be supplier friendly" },
  {
    role: "assistant" as const,
    content:
      'Here is a supplier-friendly 9.1:\n\n> 9.1 The Customer indemnifies the Supplier against all losses...\n\nWould you like a fallback too?',
  },
];

describe("lastExchange", () => {
  it("finds the last answer and the question before it", () => {
    expect(lastExchange(chat)).toEqual({ question: chat[0].content, answer: chat[1].content });
  });

  it("skips an empty in-flight answer", () => {
    expect(lastExchange([...chat, { role: "user", content: "x" }, { role: "assistant", content: "" }])).toEqual({
      question: chat[0].content,
      answer: chat[1].content,
    });
  });

  it("returns null with no answer", () => {
    expect(lastExchange([{ role: "user", content: "hi" }])).toBeNull();
  });
});

describe("proposalHandoff", () => {
  it("makes the earlier answer the instruction and keeps the typed text for display", () => {
    const h = proposalHandoff("yes, can you insert this into the text", lastExchange(chat)!);
    expect(h.display).toBe("yes, can you insert this into the text");
    expect(h.instruction).toContain("Rewrite 9.1 to be supplier friendly");
    expect(h.instruction).toContain("9.1 The Customer indemnifies the Supplier");
    expect(h.instruction).toMatch(/never put commentary/i);
    expect(h.instruction).toMatch(/put it in comments/);
    expect(h.instruction).toMatch(/consequential amendments/);
  });

  it("caps a very long answer", () => {
    const h = proposalHandoff("insert it", { question: "q", answer: "a".repeat(50_000) });
    expect(h.instruction.length).toBeLessThan(13_500);
    expect(h.instruction).toContain("[cut]");
  });
});

describe("requestHandoff", () => {
  it("passes a request through unchanged when there is no chat", () => {
    expect(requestHandoff("add a cap", null)).toEqual({ instruction: "add a cap", display: "add a cap" });
  });

  it("adds the recent chat as background context", () => {
    const h = requestHandoff("suggest one and insert it", lastExchange(chat));
    expect(h.display).toBe("suggest one and insert it");
    expect(h.instruction.startsWith("suggest one and insert it")).toBe(true);
    expect(h.instruction).toContain("for context only");
    expect(h.instruction).toContain("Rewrite 9.1");
  });
});
