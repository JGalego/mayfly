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

  it("reads links to web pages, and leaves any other kind of link as text", () => {
    assert.deepEqual(inline("See [the docs](https://hono.dev/docs) or <https://hono.dev>, not [this](javascript:alert(1))."), [
      text("See "),
      { kind: "link", text: "the docs", url: "https://hono.dev/docs" },
      text(" or "),
      { kind: "link", text: "https://hono.dev", url: "https://hono.dev" },
      text(", not [this](javascript:alert(1))."),
    ]);
  });
});

describe("tables and quotes", () => {
  it("reads a table: its header, the line under it, and its rows", () => {
    assert.deepEqual(blocks("| Route | Does |\n|---|:--|\n| `/` | home |\n| /bills | **list** |\n\nAfter."), [
      {
        kind: "table",
        head: [[text("Route")], [text("Does")]],
        rows: [
          [[{ kind: "code", text: "/" }], [text("home")]],
          [[text("/bills")], [{ kind: "strong", text: "list" }]],
        ],
      },
      { kind: "paragraph", inline: [text("After.")] },
    ]);
  });

  it("reads a quote over the lines that start with >", () => {
    assert.deepEqual(blocks("> It said\n> this.\nThen that."), [
      { kind: "quote", inline: [text("It said\nthis.")] },
      { kind: "paragraph", inline: [text("Then that.")] },
    ]);
  });
});
