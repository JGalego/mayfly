import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dataProblem } from "./data-fit.ts";

describe("whether a version fits the data an app keeps", () => {
  it("fits when every stored record does", () => {
    assert.equal(dataProblem({ kinds: ["task:"], misfits: [] }), null);
  });

  it("says how many records of which kind lack a field or hold it as another type, never what they hold", () => {
    const problem = dataProblem({
      kinds: ["task:"],
      misfits: [
        { kind: "task:", field: "due", expected: "string", found: "missing", records: 2 },
        { kind: "task:", field: "points", expected: "number", found: "string", records: 1 },
      ],
    });

    assert.equal(
      problem,
      [
        "Stored records don't fit this version:",
        "",
        "- 2 `task:` records have no `due` but this version needs it as `string`",
        "- 1 `task:` record has `points` as `string` but this version needs `number`",
      ].join("\n"),
    );
  });
});
