import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { newPassword } from "./secrets.ts";
import { WORDS } from "./words.ts";

describe("the owner's password", () => {
  it("is six words from the list, joined by hyphens, which a phone keyboard types easily", () => {
    const words = newPassword().split("-");

    assert.equal(words.length, 6);
    assert.ok(words.every((word) => WORDS.includes(word)));
  });

  it("is chosen afresh each time", () => {
    assert.notEqual(newPassword(), newPassword());
  });
});
