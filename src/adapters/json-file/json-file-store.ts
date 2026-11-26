import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { StateStore } from "../../engine/ports.ts";
import { upgradeState } from "../../engine/saved-state.ts";
import { EMPTY_STATE } from "../../engine/state.ts";

/** Keeps the state in one JSON file that only its owner can read, since it holds secrets. */
export function jsonFileStore(path: string): StateStore {
  return {
    async load() {
      try {
        return upgradeState(JSON.parse(await readFile(path, "utf8")));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_STATE;
        throw error;
      }
    },

    async save(state) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      // Written aside and renamed into place, so a crash never leaves half a file.
      const partial = `${path}.partial`;
      await writeFile(partial, JSON.stringify(state, null, 2), { mode: 0o600 });
      await rename(partial, path);
    },
  };
}
