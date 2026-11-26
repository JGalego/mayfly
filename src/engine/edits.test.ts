import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyEdits } from "./edits.ts";

const routes = 'const title = "Lunch";\nconst total = 0;\nexport default app;\n';

describe("applyEdits", () => {
  it("replaces each edit's lines in turn", () => {
    const applied = applyEdits(routes, [
      { search: 'const title = "Lunch";\n', replace: 'const title = "Lunch split";\n' },
      { search: "const total = 0;\n", replace: "" },
    ]);

    assert.deepEqual(applied, { ok: true, routes: 'const title = "Lunch split";\nexport default app;\n' });
  });

  it("keeps a dollar sign in the new code as it is", () => {
    const applied = applyEdits(routes, [{ search: "const total = 0;\n", replace: "const total = `$${0}`;\n" }]);

    assert.equal(applied.ok && applied.routes.includes("`$${0}`"), true);
  });

  it("explains an edit that matches nothing, or more than one place", () => {
    const missing = applyEdits(routes, [{ search: "const nothing;\n", replace: "" }]);
    const twice = applyEdits(routes, [{ search: "const ", replace: "let " }]);

    assert.match(missing.ok ? "" : missing.problem, /edit 1 are not in routes\.ts/);
    assert.match(twice.ok ? "" : twice.problem, /appear 2 times/);
  });
});
