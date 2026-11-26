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

  it("leaves a state saved with versions as it is", () => {
    const state = upgradeState({ owner, apps: [unversioned] });

    assert.deepEqual(upgradeState(JSON.parse(JSON.stringify(state))), state);
  });
});
