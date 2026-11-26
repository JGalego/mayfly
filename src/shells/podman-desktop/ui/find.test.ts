import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchesOf, replacedAll } from "./find.ts";

describe("find", () => {
  it("finds every place the text is, whatever its case, none overlapping", () => {
    assert.deepEqual(matchesOf("Total total TOTAL", "total"), [0, 6, 12]);
    assert.deepEqual(matchesOf("aaaa", "aa"), [0, 2]);
    assert.deepEqual(matchesOf("abc", ""), []);
  });

  it("replaces every match, whatever its case, and nothing else", () => {
    assert.equal(replacedAll("Total total x", "total", "sum"), "sum sum x");
    assert.equal(replacedAll("a.b", ".", "!"), "a!b", "the text is plain, not a pattern");
  });
});
