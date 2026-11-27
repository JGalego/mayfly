import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { kindFor, kindsFrom, misfitsOf, refusal } from "./records.ts";

const kinds = kindsFrom({
  "task:": { title: "string", done: "boolean", due: "string?", tags: "string[]?", points: "number" },
  "note:": { text: "string" },
});
const task = kindFor(kinds, "task:1");

describe("the records an app declares", () => {
  it("finds the kind of a key by its prefix, and none for a key of no kind", () => {
    assert.equal(kindFor(kinds, "note:ana@example.com:7")?.prefix, "note:");
    assert.equal(kindFor(kinds, "event:1"), undefined);
    assert.equal(kindFor(kinds, "task:"), undefined, "a key names one record after its prefix");
    assert.equal(kindFor(kinds, "task"), undefined);
  });

  it("refuses a declaration that isn't kinds of record by prefix, each with typed fields", () => {
    assert.throws(() => kindsFrom([]), /`records` must be an object of kinds by key prefix/);
    assert.throws(() => kindsFrom({ task: { title: "string" } }), /`task` must be a prefix of lowercase letters, digits and hyphens ending in a colon, such as `task:`/);
    assert.throws(() => kindsFrom({ "task:": "string" }), /`task:` must be an object of fields and their types/);
    assert.throws(() => kindsFrom({ "task:": { "due-date": "string" } }), /`task:` can't have a field called `due-date`: use letters, digits and underscores, starting with a letter/);
    assert.throws(() => kindsFrom({ "task:": { due: "date" } }), /`due` of `task:` is `date`, which isn't string, number or boolean, a list of one such as `string\[\]`, or any of these with `\?`/);
  });

  it("finds nothing wrong with a record that fits its kind, whatever else it holds", () => {
    assert.deepEqual(misfitsOf(task!, { title: "a", done: false, points: 3, tags: ["x"], due: null, from: "an older version" }), []);
  });

  it("names each declared field a record lacks or holds as another type, never its value", () => {
    assert.deepEqual(misfitsOf(task!, { done: "yes", tags: [1], points: Number.NaN, due: 4 }), [
      { field: "title", expected: "string", found: "missing" },
      { field: "done", expected: "boolean", found: "string" },
      { field: "due", expected: "string?", found: "number" },
      { field: "tags", expected: "string[]?", found: "number[]" },
      { field: "points", expected: "number", found: "NaN" },
    ]);
    assert.deepEqual(misfitsOf(task!, { title: null, done: true, points: 1, tags: "x" }), [
      { field: "title", expected: "string", found: "null" },
      { field: "tags", expected: "string[]?", found: "string" },
    ]);
  });

  it("refuses to keep a record that doesn't fit, or with a field its kind doesn't declare, saying why in one sentence", () => {
    assert.equal(refusal(task!, { title: "a", done: true, points: 1 }), undefined);
    assert.equal(refusal(task!, { title: "a", done: true }), "`task:` records need `points` as number but this one has none");
    assert.equal(refusal(task!, { title: "a", done: 1, points: 1 }), "`task:` records need `done` as boolean but this one has a number");
    assert.equal(refusal(task!, { title: "a", done: true, points: 1, colour: "red" }), "`task:` records have no field `colour` so declare it in `records`");
    assert.equal(refusal(task!, ["a"]), "A record must be an object of fields");
  });
});
