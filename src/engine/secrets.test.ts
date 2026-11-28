import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chosenPassword, newPassword } from "./secrets.ts";
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

describe("a password someone chooses", () => {
  it("is kept as it is when it's long enough", () => {
    assert.equal(chosenPassword("correct horse battery"), "correct horse battery");
  });

  it("needs at least 12 characters", () => {
    assert.throws(() => chosenPassword("short-pass"), /Use at least 12 characters/);
  });

  // Dex hashes passwords with bcrypt, which ignores everything past 72 bytes.
  it("fits in 72 bytes", () => {
    assert.equal(chosenPassword("é".repeat(36)).length, 36);
    assert.throws(() => chosenPassword("é".repeat(37)), /Use a shorter password/);
  });
});
