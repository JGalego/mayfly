import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseManifest } from "./manifest.ts";
import { ContractViolation } from "./contract-violation.ts";

const valid = { name: "expenses", image: "localhost/mayfly-expenses:1" };

describe("parseManifest", () => {
  it("accepts a name and an image", () => {
    assert.deepEqual(parseManifest(valid), valid);
  });

  it("drops fields the contract does not know, so none can loosen it", () => {
    const manifest = parseManifest({ ...valid, privileged: true, user: "root" });

    assert.deepEqual(manifest, valid);
  });

  it("rejects a name that is not a short lowercase DNS label", () => {
    for (const name of ["", "Expenses", "my app", "-x", "x-", "a".repeat(41), 42, undefined]) {
      assert.throws(() => parseManifest({ ...valid, name }), ContractViolation, String(name));
    }
  });

  it("rejects a missing, blank or spaced image", () => {
    for (const image of [undefined, "", " ", "has space"]) {
      assert.throws(() => parseManifest({ ...valid, image }), ContractViolation, String(image));
    }
  });

  it("rejects anything that is not an object", () => {
    for (const value of [null, "expenses", [], 1]) {
      assert.throws(() => parseManifest(value), ContractViolation, String(value));
    }
  });
});
