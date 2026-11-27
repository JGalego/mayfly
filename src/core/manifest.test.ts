import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAppName } from "./manifest.ts";
import { ContractViolation } from "./contract-violation.ts";

describe("an app's name", () => {
  it("is a short lowercase DNS label", () => {
    assert.equal(parseAppName("lunch-split-2"), "lunch-split-2");
    for (const name of ["", "Expenses", "my app", "-x", "x-", "a".repeat(41), 42, undefined]) {
      assert.throws(() => parseAppName(name), ContractViolation, String(name));
    }
  });

  it("is never the name of Mayfly's sign-in, whose pod an app's would replace", () => {
    assert.throws(() => parseAppName("dex"), /Mayfly's sign-in/);
  });
});
