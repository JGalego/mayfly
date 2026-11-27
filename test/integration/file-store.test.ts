import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileStore } from "../../src/adapters/files/file-store.ts";

describe("the file store", () => {
  it("keeps a file once under its hash, for its owner only, and gives it back", async () => {
    const folder = join(await mkdtemp(join(tmpdir(), "mayfly-")), "files");
    const files = fileStore(folder);
    const data = new TextEncoder().encode("who,amount\nana,12");

    const id = await files.put(data);
    const again = await files.put(data);

    assert.equal(again, id);
    assert.deepEqual(await readdir(folder), [id]);
    assert.equal((await stat(join(folder, id))).mode & 0o777, 0o600);
    assert.deepEqual(await files.get(id), data);
  });

  it("refuses an id that is not a hash, so nothing outside the folder can be read", async () => {
    const files = fileStore(join(await mkdtemp(join(tmpdir(), "mayfly-")), "files"));

    await assert.rejects(files.get("../state.json"), /no file/);
  });

  it("removes a file, and takes one already gone as removed", async () => {
    const folder = await mkdtemp(join(tmpdir(), "mayfly-files-"));
    const files = fileStore(folder);
    const id = await files.put(new Uint8Array([1, 2, 3]));

    await files.remove(id);
    await files.remove(id);

    assert.deepEqual(await readdir(folder), []);
  });
});
