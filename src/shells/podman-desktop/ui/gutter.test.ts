import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lineMarks } from "./gutter.ts";

const code = "a\nb\nc\n";

describe("lineMarks", () => {
  it("marks nothing when the code is as it was", () => {
    assert.deepEqual(lineMarks(code, code), [null, null, null, null]);
  });

  it("marks lines that are new", () => {
    assert.deepEqual(lineMarks(code, "a\nnew\nb\nc\n"), [null, "added", null, null, null]);
  });

  it("marks lines that replace others as changed, however many there are", () => {
    assert.deepEqual(lineMarks(code, "a\nB\nc\n"), [null, "changed", null, null]);
    assert.deepEqual(lineMarks(code, "a\nB1\nB2\nc\n"), [null, "changed", "changed", null, null]);
  });

  it("marks the line that follows lines that were removed, at the end too", () => {
    assert.deepEqual(lineMarks(code, "a\nc\n"), [null, "removed", null]);
    assert.deepEqual(lineMarks(code, "b\nc\n"), ["removed", null, null]);
    assert.deepEqual(lineMarks(code, "a\nb\n"), [null, null, "removed"]);
  });

  it("marks a line whose ending changed, as the last line can", () => {
    assert.deepEqual(lineMarks(code, "a\nb\nc"), [null, null, "changed"]);
  });
});
