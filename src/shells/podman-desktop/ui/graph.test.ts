import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { VersionView } from "../../../engine/engine.ts";
import { graph } from "./graph.ts";

function version(id: string, parent: string | null): VersionView {
  return { id, parent, request: "r", by: { kind: "model", name: "the test model" }, attempt: 1, summary: "", problem: null, spent: { input: 0, output: 0 }, at: 0, lines: 1, thinkingWords: 0 };
}

describe("the history graph", () => {
  it("draws a straight line for versions that each start from the one before", () => {
    const rows = graph([version("a", null), version("b", "a"), version("c", "b")]);

    assert.deepEqual(
      rows.map((row) => [row.version.id, row.lanes.join(), row.tip, row.root]),
      [
        ["c", "dot", true, false],
        ["b", "dot", false, false],
        ["a", "dot", false, true],
      ],
    );
  });

  it("gives a branch its own lane until it joins the version it started from", () => {
    // b and c both start from a: c is a branch made after going back to a.
    const rows = graph([version("a", null), version("b", "a"), version("c", "a")]);

    assert.deepEqual(
      rows.map((row) => [row.version.id, row.lanes.join()]),
      [
        ["c", "dot"],
        ["b", "line,dot"],
        ["a", "dot,join"],
      ],
    );
  });
});
