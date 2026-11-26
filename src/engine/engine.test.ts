import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ConfigMap, KubeObject } from "../core/kube.ts";
import { createEngine } from "./engine.ts";
import type { Deployer, IdentitySource, StateStore } from "./ports.ts";
import { EMPTY_STATE, type State } from "./state.ts";

const expenses = { name: "expenses", image: "localhost/mayfly-expenses:1" };
const notes = { name: "notes", image: "localhost/mayfly-notes:1" };

describe("the engine", () => {
  it("deploys an app behind sign-in and returns its loopback URL", async () => {
    const { engine, deployed } = setUp();

    const app = await engine.deploy(expenses);

    assert.deepEqual(app, { name: "expenses", url: "http://localhost:18100/" });
    assert.deepEqual(names(deployed[0]), [
      "ConfigMap/mayfly-expenses-auth",
      "Secret/mayfly-expenses-auth",
      "Pod/mayfly-expenses",
    ]);
  });

  it("lets only the owner into a new app", async () => {
    const { engine, deployed } = setUp();

    await engine.deploy(expenses);

    const configMap = deployed[0]?.find((o): o is ConfigMap => o.kind === "ConfigMap");
    assert.equal(configMap?.data.OAUTH2_PROXY_ALLOWED_GROUPS, "owner");
  });

  it("registers the app with the identity provider before starting it", async () => {
    const { engine, log, synced } = setUp();

    await engine.deploy(expenses);

    assert.deepEqual(log, ["sync", "deploy"]);
    assert.deepEqual(synced[0]?.apps.map((app) => app.manifest.name), ["expenses"]);
  });

  it("gives each app its own port", async () => {
    const { engine } = setUp();

    const first = await engine.deploy(expenses);
    const second = await engine.deploy(notes);

    assert.notEqual(first.url, second.url);
  });

  it("keeps an app's URL and secrets when it is deployed again", async () => {
    const { engine, deployed } = setUp();

    const before = await engine.deploy(expenses);
    const after = await engine.deploy({ ...expenses, image: "localhost/mayfly-expenses:2" });

    assert.equal(after.url, before.url);
    assert.deepEqual(secretOf(deployed[1]), secretOf(deployed[0]));
  });

  it("remembers the apps it deployed", async () => {
    const { engine } = setUp();

    await engine.deploy(expenses);
    await engine.deploy(notes);

    assert.deepEqual(
      (await engine.list()).map((app) => app.name),
      ["expenses", "notes"],
    );
  });

  it("stops, unregisters and forgets an app it removes", async () => {
    const { engine, deployed, removed, synced } = setUp();
    await engine.deploy(expenses);
    await engine.deploy(notes);

    await engine.remove("expenses");

    assert.deepEqual(names(removed[0]), names(deployed[0]));
    assert.deepEqual(synced.at(-1)?.apps.map((app) => app.manifest.name), ["notes"]);
    assert.deepEqual(
      (await engine.list()).map((app) => app.name),
      ["notes"],
    );
  });

  it("refuses to remove an app it does not know", async () => {
    const { engine } = setUp();

    await assert.rejects(engine.remove("ghost"), /no app named ghost/);
  });

  it("creates the owner once, with a long random password", async () => {
    const { engine } = setUp();

    const owner = await engine.owner();

    assert.ok(owner.password.length >= 16);
    assert.deepEqual(await engine.owner(), owner);
  });
});

function setUp() {
  const log: string[] = [];
  const deployed: (readonly KubeObject[])[] = [];
  const removed: (readonly KubeObject[])[] = [];
  const synced: State[] = [];
  let state: State = EMPTY_STATE;
  const store: StateStore = {
    load: async () => state,
    save: async (next) => void (state = next),
  };
  const deployer: Deployer = {
    deploy: async (objects) => void (log.push("deploy"), deployed.push(objects)),
    remove: async (objects) => void (log.push("remove"), removed.push(objects)),
  };
  const identity: IdentitySource = {
    sync: async (next) => void (log.push("sync"), synced.push(next)),
    settingsFor: () => ({ OAUTH2_PROXY_CLIENT_ID: "fake" }),
  };
  return { engine: createEngine({ store, deployer, identity }), deployed, removed, synced, log };
}

function names(objects: readonly KubeObject[] | undefined): string[] {
  return (objects ?? []).map((o) => `${o.kind}/${o.metadata.name}`);
}

function secretOf(objects: readonly KubeObject[] | undefined) {
  return objects?.find((o) => o.kind === "Secret");
}
