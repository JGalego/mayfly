import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compact, tokens } from "./format.ts";

describe("counts and tokens", () => {
  it("are short enough to glance at", () => {
    assert.deepEqual([900, 3_400, 21_000, 12_000_000].map(compact), ["900", "3.4K", "21K", "12M"]);
  });

  it("say tokens in, out and thinking, leaving out thinking when there was none", () => {
    assert.equal(tokens({ input: 900, output: 1_100, thinking: 2_900 }), "900 tokens in, 1.1K out, 2.9K thinking");
    assert.equal(tokens({ input: 21_000, output: 3_400, thinking: 0 }), "21K tokens in, 3.4K out");
  });
});
