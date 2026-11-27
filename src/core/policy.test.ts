import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allowedRoles } from "./policy.ts";
import { ContractViolation } from "./contract-violation.ts";

describe("the roles an app lets in", () => {
  it("go to the proxy as one list", () => {
    assert.equal(allowedRoles({ roles: ["finance", "Expenses.Approve"] }), "finance,Expenses.Approve");
  });

  it("are never none, which the proxy would read as everyone", () => {
    assert.throws(() => allowedRoles({ roles: [] }), ContractViolation);
  });

  it("are each a plain token, which the proxy can't split or misread", () => {
    for (const role of ["a,b", "has space", "", "a]b"]) {
      assert.throws(() => allowedRoles({ roles: [role] }), ContractViolation, role);
    }
  });
});
