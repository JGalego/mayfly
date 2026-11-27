import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kindsFrom } from "./records.ts";
import { checkStore, copyStore, openStore } from "./store.ts";

const folder = mkdtempSync(join(tmpdir(), "mayfly-store-"));
let files = 0;
const newFile = () => join(folder, `${++files}.db`);
after(() => rmSync(folder, { recursive: true, force: true }));

const v1 = kindsFrom({ "task:": { title: "string", done: "boolean" }, "note:": { text: "string" } });
const v2 = kindsFrom({ "task:": { title: "string", done: "boolean", tags: "string[]?" }, "note:": { text: "string" } });

describe("an app's store", () => {
  it("keeps a record by its key, and has none for a key it never kept", () => {
    const store = openStore(newFile(), v1);

    store.set("task:1", { title: "Buy milk", done: false });

    assert.deepEqual(store.get("task:1"), { title: "Buy milk", done: false });
    assert.equal(store.get("task:2"), undefined);
  });

  it("keeps records across restarts", () => {
    const file = newFile();
    openStore(file, v1).set("note:1", { text: "hello" });

    assert.deepEqual(openStore(file, v1).get("note:1"), { text: "hello" });
  });

  it("lists the records under a prefix in key order, such as one person's", () => {
    const store = openStore(newFile(), v1);
    store.set("note:bo@example.com:1", { text: "b" });
    store.set("note:ana@example.com:2", { text: "a2" });
    store.set("note:ana@example.com:1", { text: "a1" });
    store.set("task:1", { title: "t", done: true });

    assert.deepEqual(store.list("note:ana@example.com:"), [
      { key: "note:ana@example.com:1", value: { text: "a1" } },
      { key: "note:ana@example.com:2", value: { text: "a2" } },
    ]);
    assert.equal(store.list("note:").length, 3);
  });

  it("deletes a record", () => {
    const store = openStore(newFile(), v1);
    store.set("task:1", { title: "t", done: true });

    store.delete("task:1");

    assert.equal(store.get("task:1"), undefined);
  });

  it("refuses a record that doesn't fit its kind, and keys of no declared kind", () => {
    const store = openStore(newFile(), v1);

    assert.throws(() => store.set("task:1", { title: "t" }), /`task:` records need `done` as boolean but this one has none/);
    assert.throws(() => store.set("event:1", { title: "t" }), /`event:1` belongs to no kind in `records` so declare its prefix there/);
    assert.throws(() => store.get("event:1"), /declare its prefix/);
    assert.throws(() => store.list("ev"), /List records by a prefix in `records` such as `task:`/);
  });

  it("says an app that declares no records has to before it keeps any", () => {
    const store = openStore(join(folder, "never", "opened.db"), []);

    assert.throws(() => store.get("task:1"), /`task:1` belongs to no kind in `records`/);
  });

  it("refuses a record over 1 MiB", () => {
    const store = openStore(newFile(), v1);

    assert.throws(() => store.set("note:1", { text: "x".repeat(1024 * 1024) }), /A record can be at most 1 MiB/);
  });

  // After an undo, the older version writes records that a newer one gave more fields.
  it("keeps the fields a version doesn't declare when it changes a record, and shows it only the ones it does", () => {
    const file = newFile();
    openStore(file, v2).set("task:1", { title: "t", done: false, tags: ["home"] });
    const older = openStore(file, v1);

    assert.deepEqual(older.get("task:1"), { title: "t", done: false });
    older.set("task:1", { ...older.get("task:1"), done: true });

    assert.deepEqual(openStore(file, v2).get("task:1"), { title: "t", done: true, tags: ["home"] });
  });
});

describe("checking an app's stored records against a version", () => {
  it("counts the records of each declared kind that don't fit, by field, and leaves kinds it doesn't declare alone", () => {
    const file = newFile();
    const store = openStore(file, v1);
    store.set("task:1", { title: "a", done: false });
    store.set("task:2", { title: "b", done: true });
    store.set("note:1", { text: "n" });
    const next = kindsFrom({ "task:": { title: "string", done: "boolean", due: "string", priority: "number?" } });

    assert.deepEqual(checkStore(file, next), {
      kinds: ["task:"],
      misfits: [{ kind: "task:", field: "due", expected: "string", found: "missing", records: 2 }],
    });
  });

  it("finds nothing to check before the app keeps anything", () => {
    assert.deepEqual(checkStore(join(folder, "none.db"), v1), { kinds: ["task:", "note:"], misfits: [] });
  });
});

describe("copying an app's store", () => {
  it("copies every record, as a trial, a rename or a backup needs", () => {
    const from = newFile();
    const to = newFile();
    openStore(from, v1).set("task:1", { title: "a", done: false });

    copyStore(from, to);

    assert.deepEqual(openStore(to, v1).list("task:"), [{ key: "task:1", value: { title: "a", done: false } }]);
  });

  it("copies nothing from an app that never kept anything", () => {
    const to = newFile();

    copyStore(join(folder, "none.db"), to);

    assert.deepEqual(checkStore(to, v1).misfits, []);
  });
});
