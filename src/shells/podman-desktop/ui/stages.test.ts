import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { codeIn, elapsed, lineCount, stagesOf, stagesOfVersions } from "./stages.ts";

describe("the stages a person sees", () => {
  it("puts the code on the writing stage, then adds building, trying and starting", () => {
    const stages = stagesOf([
      { kind: "writing", attempt: 1 },
      { kind: "wrote", routes: "export default 1;\n" },
      { kind: "building" },
      { kind: "trying" },
      { kind: "deploying" },
    ]);

    assert.deepEqual(stages, [
      { kind: "writing", attempt: 1, code: "export default 1;\n", live: false },
      { kind: "building", attempt: 1 },
      { kind: "trying", attempt: 1 },
      { kind: "deploying", attempt: 1 },
    ]);
  });

  it("marks the stage that failed, and numbers the fix that follows", () => {
    const stages = stagesOf([{ kind: "writing", attempt: 1 }, { kind: "trying" }, { kind: "failed", problem: "boom" }, { kind: "writing", attempt: 2 }]);

    assert.equal(stages[1]?.problem, "boom");
    assert.deepEqual(stages[2], { kind: "writing", attempt: 2 });
  });

  it("shows only the code of a reply the model is still writing", () => {
    const [stage] = stagesOf([{ kind: "writing", attempt: 1 }, { kind: "draft", text: "name: notes\n```ts\nconst a = 1;\ncon" }]);

    assert.deepEqual(stage, { kind: "writing", attempt: 1, code: "const a = 1;\ncon", live: true });
  });
});

describe("the stages of a finished request", () => {
  const version = { parent: null, request: "r", summary: "", spent: { input: 0, output: 0 }, at: 0, lines: 9 };

  it("show each attempt's writing, building and trying, and the start of the one that passed", () => {
    const stages = stagesOfVersions([
      { ...version, id: "a", attempt: 1, problem: "boom" },
      { ...version, id: "b", attempt: 2, problem: null },
    ]);

    assert.deepEqual(
      stages.map((stage) => [stage.kind, stage.attempt, stage.problem ?? stage.version ?? ""]),
      [
        ["writing", 1, "a"],
        ["building", 1, ""],
        ["trying", 1, "boom"],
        ["writing", 2, "b"],
        ["building", 2, ""],
        ["trying", 2, ""],
        ["deploying", 2, ""],
      ],
    );
  });

  it("show an attempt with no usable code as a failed writing stage", () => {
    assert.deepEqual(stagesOfVersions([{ ...version, id: "a", attempt: 1, lines: 0, problem: "no code" }]), [{ kind: "writing", attempt: 1, problem: "no code" }]);
  });
});

describe("codeIn", () => {
  it("is empty until the code starts, and stops at the closing fence", () => {
    assert.equal(codeIn("name: notes\n"), "");
    assert.equal(codeIn("name: notes\n```ts\nexport default 1;\n```\nKeeps notes."), "export default 1;\n");
  });
});

describe("lineCount and elapsed", () => {
  it("count lines whether or not the last one has ended, and read like a clock", () => {
    assert.equal(lineCount("a\nb\n"), 2);
    assert.equal(lineCount("a\nb"), 2);
    assert.equal(elapsed(0, 65_400), "1:05");
  });
});
