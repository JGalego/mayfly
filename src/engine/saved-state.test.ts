import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { upgradeState } from "./saved-state.ts";
import { EMPTY_STATE } from "./state.ts";

const owner = { email: "o@mayfly.local", username: "o", password: "p" };
const unversioned = {
  manifest: { name: "lunch", image: "localhost/mayfly-app-lunch:abc" },
  hostPort: 18100,
  clientSecret: "c",
  cookieSecret: "k",
  routes: "export default 1;\n",
  conversation: [
    { from: "person", text: "split lunch bills" },
    { from: "mayfly", text: "Splits bills." },
  ],
  spent: { input: 10, output: 5 },
};
const counted = { input: 10, output: 5, thinking: 0 };

describe("upgradeState", () => {
  it("fills in what a state saved before tokens were counted lacks", () => {
    assert.deepEqual(upgradeState({ owner, apps: [] }), { ...EMPTY_STATE, owner });
  });

  it("turns an app saved before versions into one whose running code is its only version", () => {
    const [app] = upgradeState({ owner, apps: [unversioned], spent: { input: 10, output: 5 } }).apps;

    assert.equal(app?.name, "lunch");
    assert.equal(app?.versions.length, 1);
    assert.partialDeepStrictEqual(app?.versions[0], { routes: "export default 1;\n", image: "localhost/mayfly-app-lunch:abc", problem: null, request: "split lunch bills" });
    assert.equal(app?.head, app?.versions[0]?.id);
    assert.partialDeepStrictEqual(app?.conversation[1], { from: "mayfly", versions: [app?.head] });
  });

  it("counts no thinking in tokens saved before thinking was counted apart", () => {
    const state = upgradeState({ owner, apps: [unversioned], spent: { input: 10, output: 5 } });

    assert.deepEqual([state.spent, state.apps[0]?.spent, state.apps[0]?.versions[0]?.spent], [counted, counted, counted]);
  });

  it("starts the ledger with the calls that made the versions it has, oldest first", () => {
    const version = { parent: null, request: "r", attempt: 1, routes: "", summary: "", problem: "boom", image: null, spent: counted };
    const app = upgradeState({ owner, apps: [unversioned] }).apps[0];
    const lunch = { ...app, versions: [
      { ...version, id: "a", at: 5, by: { kind: "model", name: "OpenAI · gpt-6.2-sol" } },
      { ...version, id: "b", at: 9, by: { kind: "person", name: "o@mayfly.local" } },
    ] };

    const { calls } = upgradeState({ owner, apps: [lunch] });

    assert.deepEqual(calls, [{ at: 5, app: "lunch", provider: "OpenAI", model: "OpenAI · gpt-6.2-sol", spent: counted, passed: false }]);
  });

  it("gives calls kept before their outcome was noted the outcome of the version each made, before the app's next call", () => {
    const version = { parent: null, request: "r", attempt: 1, routes: "", summary: "", spent: counted, by: { kind: "model", name: "m" } };
    const app = upgradeState({ owner, apps: [unversioned] }).apps[0];
    const lunch = { ...app, versions: [
      { ...version, id: "a", at: 12, problem: "boom", image: null },
      { ...version, id: "b", at: 32, problem: null, image: "i" },
    ] };
    const call = { app: "lunch", provider: "p", model: "m", spent: counted };
    // The first call was cut short and made no version; the call for the removed app's version is gone with it.
    // A question wrote no code, so it takes no version's outcome either.
    const calls = [{ ...call, at: 5 }, { ...call, at: 10 }, { ...call, at: 30 }, { ...call, at: 40, app: "gone" }, { ...call, at: 50, passed: true }, { ...call, at: 11, question: true }];

    const upgraded = upgradeState({ owner, apps: [lunch], calls: calls.toSorted((a, b) => a.at - b.at) }).calls;

    assert.deepEqual(upgraded.map((c) => c.passed), [undefined, false, undefined, true, undefined, true]);
  });

  it("leaves a state saved with versions as it is", () => {
    const state = upgradeState({ owner, apps: [unversioned] });

    assert.deepEqual(upgradeState(JSON.parse(JSON.stringify(state))), state);
  });
});
