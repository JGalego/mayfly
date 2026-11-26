import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jsonFileStore } from "../../src/adapters/json-file/json-file-store.ts";
import { EMPTY_STATE, type State } from "../../src/engine/state.ts";

const state: State = { owner: { email: "o@mayfly.local", username: "o", password: "p" }, apps: [] };

describe("the JSON file store", () => {
  it("starts empty when there is no file yet", async () => {
    assert.deepEqual(await jsonFileStore(await newPath()).load(), EMPTY_STATE);
  });

  it("reads back what it saved", async () => {
    const store = jsonFileStore(await newPath());

    await store.save(state);

    assert.deepEqual(await store.load(), state);
  });

  it("keeps the file readable by its owner only, since it holds secrets", async () => {
    const path = await newPath();

    await jsonFileStore(path).save(state);

    assert.equal((await stat(path)).mode & 0o777, 0o600);
  });
});

async function newPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "mayfly-")), "nested", "state.json");
}
