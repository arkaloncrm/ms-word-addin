import { describe, expect, it } from "vitest";
import { classifyIntent, stripLeadIns } from "./intent";

describe("stripLeadIns", () => {
  it("removes stacked conversational lead-ins", () => {
    expect(stripLeadIns("yes, can you insert this into the text")).toBe("insert this into the text");
    expect(stripLeadIns("Ok please could you rewrite 9.1")).toBe("rewrite 9.1");
    expect(stripLeadIns("can you please suggest one")).toBe("suggest one");
  });

  it("leaves a message without lead-ins alone", () => {
    expect(stripLeadIns("Rewrite 9.1 to be supplier friendly")).toBe("Rewrite 9.1 to be supplier friendly");
  });
});

describe("classifyIntent: edit requests hidden behind lead-ins (tester, 24 Nov)", () => {
  it("'yes, can you insert this into the text' is an explicit follow-up edit", () => {
    expect(classifyIntent("yes, can you insert this into the text")).toEqual({
      action: "edit",
      explicit: true,
      followUp: true,
    });
  });

  it("'can you please suggest one and insert it...' is an explicit new edit, not a follow-up", () => {
    expect(
      classifyIntent(
        "can you please suggest one and insert it into the text, it needs to be supplier friendly",
      ),
    ).toEqual({ action: "edit", explicit: true, followUp: false });
  });

  it("'Suggest an acceptable use clause and insert it, supplier friendly' is an explicit edit", () => {
    expect(classifyIntent("Suggest an acceptable use clause and insert it, supplier friendly")).toEqual({
      action: "edit",
      explicit: true,
      followUp: false,
    });
  });

  it("'apply these changes' and 'use your version' point back at the last answer", () => {
    expect(classifyIntent("great, apply these changes")).toMatchObject({ action: "edit", followUp: true });
    expect(classifyIntent("please use your version")).toMatchObject({ action: "edit", followUp: true });
  });

  it("a leading strong verb still offers the Edit flow (not explicit)", () => {
    expect(classifyIntent("Rewrite 9.1 to be supplier friendly")).toEqual({ action: "edit" });
    expect(classifyIntent("ok, tighten the indemnity")).toEqual({ action: "edit" });
  });
});

describe("classifyIntent: questions stay questions", () => {
  it.each([
    "can you check my comments",
    "Should I insert a liability cap?",
    "What would you add to the contract?",
    "How do I insert a new clause?",
    "Is clause 9.1 enforceable?",
    "add up the fees in the contract",
    "what does this clause mean",
  ])("%s", (q) => {
    expect(classifyIntent(q)).toEqual({ action: "ask" });
  });
});

describe("classifyIntent: other actions read past lead-ins", () => {
  it("navigates", () => {
    expect(classifyIntent("can you take me to the termination clause")).toEqual({
      action: "navigate",
      target: "termination",
    });
  });

  it("keeps clean copy and accept-all detection", () => {
    expect(classifyIntent("make a clean copy")).toEqual({ action: "cleanCopy" });
    expect(classifyIntent("accept all changes")).toEqual({ action: "accept" });
  });
});

describe("classifyIntent: comment bubbles (tester request, 24 Nov)", () => {
  it.each([
    "put a comment bubble on 9.1 explaining why",
    "can you add comments to the changes explaining them to the other side",
    "leave a note on the indemnity for the other side",
    "please add a comment to clause 7 asking them to confirm the date",
  ])("drafts a comment: %s", (q) => {
    expect(classifyIntent(q)).toMatchObject({ action: "edit", explicit: true });
  });

  it.each(["reply to their comment on clause 7", "can you respond to Jane's comments", "answer the comments"])(
    "drafts a reply: %s",
    (q) => {
      expect(classifyIntent(q)).toMatchObject({ action: "edit", explicit: true });
    },
  );

  it("'put that in a comment on 9.1' uses the last answer", () => {
    expect(classifyIntent("put that in a comment on 9.1")).toMatchObject({ action: "edit", followUp: true });
  });

  it("'comment on X explaining why...' asks ArkLaw to write it", () => {
    expect(classifyIntent("comment on the indemnity explaining why it is too broad")).toMatchObject({
      action: "edit",
      explicit: true,
    });
  });

  it("keeps the quick literal comment for a spelled-out note or a short target", () => {
    expect(classifyIntent("comment on the liability cap: too low")).toEqual({
      action: "comment",
      target: "liability cap",
      note: "too low",
    });
    expect(classifyIntent("flag the indemnity")).toEqual({
      action: "comment",
      target: "indemnity",
      note: "Flagged for review.",
    });
  });

  it("a comment on a bare clause number is drafted (the number is not searchable text)", () => {
    expect(classifyIntent("comment on clause 9.1: check the cap")).toMatchObject({ action: "edit", explicit: true });
  });

  it("questions about comments stay questions", () => {
    expect(classifyIntent("can you check my comments")).toEqual({ action: "ask" });
    expect(classifyIntent("should I add a comment to 9.1?")).toEqual({ action: "ask" });
    expect(classifyIntent("what do the comments say")).toEqual({ action: "ask" });
  });
});
