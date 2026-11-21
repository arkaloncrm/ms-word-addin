// A new user who chooses Claude gets the model the 21 Nov 2026 comparison chose,
// and it is the first, recommended entry in the list.
import { describe, expect, it } from "vitest";
import { MODEL_OPTIONS, getModel } from "./keys";

describe("default Claude model", () => {
  it("is Claude Sonnet 5.5 when nothing has been chosen yet", () => {
    expect(getModel("anthropic")).toBe("claude-sonnet-5-5");
  });

  it("is the first, recommended entry in the list", () => {
    expect(MODEL_OPTIONS.anthropic[0]).toEqual({ id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (recommended)" });
  });
});
