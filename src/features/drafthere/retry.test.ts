import { describe, expect, it } from "vitest";
import { checkRetry } from "./retry";

const OURS = ["On termination, the Supplier must:", "(a) return all Customer Data; and", "(b) delete any copies."];
const AS_WRITTEN = OURS.join("\r") + "\r";

describe("checkRetry", () => {
  it("removes ArkLaw's version when it is exactly as written", () => {
    expect(checkRetry({ current: AS_WRITTEN, original: "", insertedCount: 4 }, OURS, "")).toBe("reject");
    // After a run-in heading the passage starts with a space.
    expect(checkRetry({ current: " Customer Data must be deleted.", original: "", insertedCount: 1 }, ["Customer Data must be deleted."], "")).toBe(
      "reject",
    );
  });

  it("also undoes the struck-out note in place, so it can be struck again", () => {
    expect(
      checkRetry({ current: AS_WRITTEN, original: "[Draft: return and delete data]\r", insertedCount: 2 }, OURS, "return and delete data"),
    ).toBe("reject");
  });

  it("touches nothing when the lawyer typed inside it, even one short word", () => {
    const typed = AS_WRITTEN.replace("all Customer Data", "all the Customer Data");
    expect(checkRetry({ current: typed, original: "", insertedCount: 5 }, OURS, "")).toBe("edited");
  });

  it("touches nothing when the lawyer split a paragraph with Enter", () => {
    const split = AS_WRITTEN.replace("(a) return all", "(a) return\rall");
    expect(checkRetry({ current: split, original: "", insertedCount: 5 }, OURS, "")).toBe("edited");
    // One-paragraph draft (nothing ArkLaw split), lawyer presses Enter inside it.
    expect(
      checkRetry(
        { current: "Customer data must be deleted\rwithin [30] days.", original: "", insertedCount: 2 },
        ["Customer data must be deleted within [30] days."],
        "",
      ),
    ).toBe("edited");
  });

  it("touches nothing when the lawyer deleted words from it", () => {
    const cut = AS_WRITTEN.replace("Customer Data", "");
    expect(checkRetry({ current: cut, original: "", insertedCount: 4 }, OURS, "")).toBe("edited");
  });

  it("touches nothing when the passage holds other deleted document text", () => {
    // A deletion that is not exactly the struck note, even one sharing its words.
    expect(checkRetry({ current: AS_WRITTEN, original: "Customer data", insertedCount: 5 }, OURS, "data")).toBe("edited");
    expect(checkRetry({ current: AS_WRITTEN, original: "[Draft: other words]", insertedCount: 5 }, OURS, "data")).toBe("edited");
  });

  it("touches nothing when part of it was accepted", () => {
    // Paragraph 1 accepted: the text reads the same, but the original is no longer empty.
    expect(checkRetry({ current: AS_WRITTEN, original: OURS[0], insertedCount: 2 }, OURS, "")).toBe("edited");
  });

  it("touches nothing when the lawyer typed after the passage and it joined the passage", () => {
    expect(checkRetry({ current: AS_WRITTEN + " Thanks.", original: "", insertedCount: 1 }, OURS, "")).toBe("edited");
  });

  it("says gone when there are no tracked insertions left", () => {
    expect(checkRetry({ current: AS_WRITTEN, original: AS_WRITTEN, insertedCount: 0 }, OURS, "")).toBe("gone");
  });
});
