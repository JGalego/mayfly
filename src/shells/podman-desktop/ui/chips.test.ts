import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spans } from "./chips.ts";

describe("spans", () => {
  it("sets apart what is in backticks, such as an app's name", () => {
    assert.deepEqual(spans("Renamed `lunch-split` to `bills`."), [
      { text: "Renamed ", chip: false },
      { text: "lunch-split", chip: true },
      { text: " to ", chip: false },
      { text: "bills", chip: true },
      { text: ".", chip: false },
    ]);
  });

  it("leaves text without a closed pair of backticks, or with a fence, as it is", () => {
    for (const text of ["Plain words.", "A lone ` stays", "```ts\nconst a = 1;\n```"]) assert.deepEqual(spans(text), [{ text, chip: false }], text);
  });
});
