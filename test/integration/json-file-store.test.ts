import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readJson, writeJson } from "../../src/adapters/json-file/json-file.ts";
import { jsonFileStore } from "../../src/adapters/json-file/json-file-store.ts";
import { EMPTY_STATE, type State } from "../../src/engine/state.ts";

const owner = { email: "o@mayfly.local", username: "o", password: "p" };
const state: State = { owner, people: [], apps: [], spent: { input: 1, output: 2, thinking: 0 }, calls: [], phoneHost: null, signInPort: null };

describe("the JSON file store", () => {
  it("starts empty when there is no file yet", async () => {
    assert.deepEqual(await jsonFileStore(await newPath()).load(), EMPTY_STATE);
  });

  it("reads back what it saved", async () => {
    const store = jsonFileStore(await newPath());

    await store.save(state);

    assert.deepEqual(await store.load(), state);
  });

  it("reads a file saved before tokens were counted", async () => {
    const path = await newPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ owner, apps: [] }));

    assert.deepEqual(await jsonFileStore(path).load(), { ...EMPTY_STATE, owner });
  });

  it("leaves one whole file when two saves overlap", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "mayfly-")), "state.json");
    const values = [{ apps: "a".repeat(200_000) }, { apps: "b".repeat(300_000) }];

    for (let round = 0; round < 20; round++) await Promise.all(values.map((value) => writeJson(path, value)));

    // The one asked for last is the one kept.
    assert.deepEqual(await readJson(path), values[1]);
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
