import type { StateStore } from "../../engine/ports.ts";
import { upgradeState } from "../../engine/saved-state.ts";
import { EMPTY_STATE } from "../../engine/state.ts";
import { readJson, writeJson } from "./json-file.ts";

/** Keeps the state in one JSON file that only its owner can read, since it holds secrets. */
export function jsonFileStore(path: string): StateStore {
  return {
    async load() {
      const saved = await readJson(path);
      return saved === undefined ? EMPTY_STATE : upgradeState(saved);
    },

    save: (state) => writeJson(path, state),
  };
}
