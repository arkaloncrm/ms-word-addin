import { describe, expect, it } from "vitest";
import { groundComments } from "./commentProposals";

const doc = "9.1 The Customer indemnifies the Supplier against all losses.\n7.2 This clause survives termination.";

describe("groundComments", () => {
  it("keeps a new comment whose anchor is in the document, dropping a copied clause number", () => {
    expect(groundComments([{ label: "Cap", anchor: "9.1 The Customer indemnifies the Supplier", text: "Please confirm." }], doc)).toEqual([
      { label: "Cap", sectionReference: null, anchor: "The Customer indemnifies the Supplier", text: "Please confirm.", replyTo: null },
    ]);
  });

  it("blanks an anchor that is not in the document instead of guessing", () => {
    expect(groundComments([{ anchor: "words not there", text: "Hi" }], doc)[0]).toMatchObject({ anchor: "", label: "Comment" });
  });

  it("keeps a reply by number and ignores its anchor", () => {
    expect(groundComments([{ label: "Reply", replyTo: 2, anchor: "x", text: "Agreed." }], doc)).toEqual([
      { label: "Reply", sectionReference: null, anchor: "", text: "Agreed.", replyTo: 2 },
    ]);
    expect(groundComments([{ replyTo: "3", text: "Ok" }], doc)[0]?.replyTo).toBe(3);
  });

  it("drops empty text, bad input, and caps the count", () => {
    expect(groundComments([{ anchor: "7.2", text: "  " }], doc)).toEqual([]);
    expect(groundComments("nope", doc)).toEqual([]);
    expect(groundComments(Array.from({ length: 50 }, () => ({ text: "x", anchor: "" })), doc)).toHaveLength(30);
  });

  it("treats replyTo 0 or a fraction as a new comment", () => {
    expect(groundComments([{ replyTo: 0, anchor: "This clause survives termination.", text: "Why?" }], doc)[0]).toMatchObject({
      replyTo: null,
      anchor: "This clause survives termination.",
    });
  });
});
