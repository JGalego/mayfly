import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { blocks, inline } from "./markdown.ts";

const text = (value: string) => ({ kind: "text", text: value });

describe("blocks", () => {
  it("reads paragraphs apart at blank lines, keeping the line breaks inside one", () => {
    assert.deepEqual(blocks("It adds the bills.\nThen it splits them.\n\nThat is all."), [
      { kind: "paragraph", inline: [text("It adds the bills.\nThen it splits them.")] },
      { kind: "paragraph", inline: [text("That is all.")] },
    ]);
  });

  it("reads bulleted and numbered lists, an item running on over an indented line", () => {
    assert.deepEqual(blocks("Steps:\n- add a bill\n- split it\n  evenly\n\n1. one\n2) two"), [
      { kind: "paragraph", inline: [text("Steps:")] },
      { kind: "list", ordered: false, items: [[text("add a bill")], [text("split it evenly")]] },
      { kind: "list", ordered: true, items: [[text("one")], [text("two")]] },
    ]);
  });

  it("reads headings, and code fences with their language, even one still being written", () => {
    assert.deepEqual(blocks("## How\n```ts\nconst a = 1;\n```\nDone.\n```\nhalf"), [
      { kind: "heading", inline: [text("How")] },
      { kind: "code", language: "ts", text: "const a = 1;" },
      { kind: "paragraph", inline: [text("Done.")] },
      { kind: "code", language: "", text: "half" },
    ]);
  });
});

describe("inline", () => {
  it("reads code, bold and italics", () => {
    assert.deepEqual(inline("Call `split()` **twice**, *not* _once_."), [
      text("Call "),
      { kind: "code", text: "split()" },
      text(" "),
      { kind: "strong", text: "twice" },
      text(", "),
      { kind: "em", text: "not" },
      text(" "),
      { kind: "em", text: "once" },
      text("."),
    ]);
  });

  it("leaves names with underscores, sums with stars and lone marks as they are", () => {
    for (const plain of ["user_name_field", "2 * 3 * 4", "a lone ` mark", "** not bold **"]) assert.deepEqual(inline(plain), [text(plain)], plain);
  });
});
