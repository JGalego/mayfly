import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { indent, newline } from "./indent.ts";

const code = "a\n  b\n    c\nd";

describe("indent", () => {
  it("puts two spaces at the caret, or in place of a selection on one line", () => {
    assert.deepEqual(indent(code, 0, 0, false), { from: 0, to: 0, text: "  ", start: 2, end: 2 });
    assert.deepEqual(indent(code, 4, 5, false), { from: 4, to: 5, text: "  ", start: 6, end: 6 });
  });

  it("indents every line a selection touches, and keeps them selected", () => {
    assert.deepEqual(indent(code, 1, 7, false), { from: 0, to: 11, text: "  a\n    b\n      c", start: 3, end: 13 });
  });

  it("outdents every line a selection touches by up to two spaces, or a tab, the caret staying on its line", () => {
    assert.deepEqual(indent(code, 3, 3, true), { from: 2, to: 5, text: "b", start: 2, end: 2 });
    assert.deepEqual(indent(code, 0, 11, true), { from: 0, to: 11, text: "a\nb\n  c", start: 0, end: 7 });
    assert.deepEqual(indent("\tx", 2, 2, true), { from: 0, to: 2, text: "x", start: 1, end: 1 });
  });

  it("leaves alone the line a selection ends at the very start of", () => {
    assert.deepEqual(indent(code, 0, 2, false), { from: 0, to: 1, text: "  a", start: 2, end: 4 });
  });
});

describe("newline", () => {
  it("starts the new line as indented as the one it breaks", () => {
    assert.deepEqual(newline("    a", 5, 5), { from: 5, to: 5, text: "\n    ", start: 10, end: 10 });
  });

  it("indents a step more after an opening bracket, and puts its closing one on a line of its own", () => {
    assert.deepEqual(newline("  f() {", 7, 7), { from: 7, to: 7, text: "\n    ", start: 12, end: 12 });
    assert.deepEqual(newline("  [x", 3, 3), { from: 3, to: 3, text: "\n    ", start: 8, end: 8 });
    assert.deepEqual(newline("  ({})", 4, 4), { from: 4, to: 4, text: "\n    \n  ", start: 9, end: 9 });
  });
});
