import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FileStore } from "../../engine/ports.ts";

// A hash and nothing else, so an id can never reach outside the folder.
const ID = /^[0-9a-f]{64}$/;

/** Attached files in a folder only their owner can read, each named by the SHA-256 of its contents. */
export function fileStore(folder: string): FileStore {
  return {
    async put(data) {
      const id = createHash("sha256").update(data).digest("hex");
      await mkdir(folder, { recursive: true, mode: 0o700 });
      // A file attached before is there already, and the same.
      await writeFile(join(folder, id), data, { mode: 0o600, flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
      return id;
    },
    async get(id) {
      if (!ID.test(id)) throw new Error(`There is no file ${id}.`);
      return new Uint8Array(await readFile(join(folder, id)));
    },
  };
}
