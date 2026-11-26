import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parsePolicy } from "./policy.ts";
import { ContractViolation } from "./contract-violation.ts";

describe("parsePolicy", () => {
  it("accepts a list of roles", () => {
    assert.deepEqual(parsePolicy({ roles: ["finance", "Expenses.Approve"] }), {
      roles: ["finance", "Expenses.Approve"],
    });
  });

  it("refuses an empty role list, which the proxy would read as everyone", () => {
    assert.throws(() => parsePolicy({ roles: [] }), ContractViolation);
  });

  it("rejects roles the proxy would split or misread", () => {
    for (const role of ["a,b", "has space", "", 7]) {
      assert.throws(() => parsePolicy({ roles: [role] }), ContractViolation, String(role));
    }
  });

  it("rejects anything without a list of roles", () => {
    for (const value of [null, [], {}, { roles: "finance" }]) {
      assert.throws(() => parsePolicy(value), ContractViolation, JSON.stringify(value));
    }
  });
});
