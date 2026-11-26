import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ConfigMap, KubeObject } from "../core/kube.ts";
import { createEngine } from "./engine.ts";
import type { Builder, Deployer, IdentitySource, Message, ModelProvider, StateStore, Trial } from "./ports.ts";
import { EMPTY_STATE, type State } from "./state.ts";

const COST = { input: 100, output: 20 };

describe("the engine", () => {
  it("creates an app from a description and deploys it behind sign-in at a loopback URL", async () => {
    const { engine, deployed } = setUp([reply("lunch")]);

    const app = await engine.create("split the team's lunch bills");

    assert.equal(app.name, "lunch");
    assert.equal(app.url, "http://localhost:18100/");
    assert.deepEqual(names(deployed[0]), ["ConfigMap/mayfly-lunch-auth", "Secret/mayfly-lunch-auth", "Pod/mayfly-lunch"]);
  });

  it("lets only the owner into a new app", async () => {
    const { engine, deployed } = setUp([reply("lunch")]);

    await engine.create("split lunch bills");

    const configMap = deployed[0]?.find((o): o is ConfigMap => o.kind === "ConfigMap");
    assert.equal(configMap?.data.OAUTH2_PROXY_ALLOWED_GROUPS, "owner");
  });

  it("registers the app with the identity provider before starting it", async () => {
    const { engine, log, synced } = setUp([reply("lunch")]);

    await engine.create("split lunch bills");

    assert.deepEqual(log, ["sync", "deploy"]);
    assert.deepEqual(synced[0]?.apps.map((app) => app.manifest.name), ["lunch"]);
  });

  it("gives each app its own port, even when the model picks a name already in use", async () => {
    const { engine } = setUp([reply("notes"), reply("notes")]);

    const first = await engine.create("keep notes");
    const second = await engine.create("keep other notes");

    assert.equal(second.name, "notes-2");
    assert.notEqual(first.url, second.url);
  });

  it("keeps the conversation: what the person asked and what the model said", async () => {
    const { engine } = setUp([reply("lunch", "Splits bills and shows who owes whom.")]);

    const app = await engine.create("split lunch bills");

    assert.deepEqual(app.conversation, [
      { from: "person", text: "split lunch bills" },
      { from: "mayfly", text: "Splits bills and shows who owes whom." },
    ]);
  });

  it("changes an app from its current code, at the same URL and with the same secrets", async () => {
    const { engine, deployed, asked } = setUp([reply("lunch", "Made it.", "v1"), reply("whatever", "Added totals.", "v2")]);
    const before = await engine.create("split lunch bills");

    const after = await engine.change("lunch", "add a monthly total");

    assert.match(asked.at(-1) ?? "", /v1/);
    assert.equal(after.url, before.url);
    assert.deepEqual(secretOf(deployed[1]), secretOf(deployed[0]));
    assert.deepEqual(after.conversation.slice(2), [
      { from: "person", text: "add a monthly total" },
      { from: "mayfly", text: "Added totals." },
    ]);
  });

  it("refuses to change an app it does not know", async () => {
    const { engine } = setUp([]);

    await assert.rejects(engine.change("ghost", "make it blue"), /no app named ghost/);
  });

  it("counts the tokens each app spent, and all of them, including failed attempts and removed apps", async () => {
    const failing: Trial = { ok: false, problem: "crashed" };
    const { engine } = setUp([reply("lunch"), reply("lunch"), reply("lunch"), reply("lunch")], [{ ok: true }, failing, failing, failing]);
    await engine.create("split lunch bills");

    await assert.rejects(engine.change("lunch", "break it"));

    assert.deepEqual((await engine.list())[0]?.spent, { input: 400, output: 80 });
    await engine.remove("lunch");
    assert.deepEqual(await engine.spent(), { input: 400, output: 80 });
  });

  it("remembers the apps it created", async () => {
    const { engine } = setUp([reply("lunch"), reply("notes")]);

    await engine.create("split lunch bills");
    await engine.create("keep notes");

    assert.deepEqual(
      (await engine.list()).map((app) => app.name),
      ["lunch", "notes"],
    );
  });

  it("stops, unregisters and forgets an app it removes", async () => {
    const { engine, deployed, removed, synced } = setUp([reply("lunch"), reply("notes")]);
    await engine.create("split lunch bills");
    await engine.create("keep notes");

    await engine.remove("lunch");

    assert.deepEqual(names(removed[0]), names(deployed[0]));
    assert.deepEqual(synced.at(-1)?.apps.map((app) => app.manifest.name), ["notes"]);
    assert.deepEqual(
      (await engine.list()).map((app) => app.name),
      ["notes"],
    );
  });

  it("refuses to remove an app it does not know", async () => {
    const { engine } = setUp([]);

    await assert.rejects(engine.remove("ghost"), /no app named ghost/);
  });

  it("creates the owner once, with a long random password", async () => {
    const { engine } = setUp([]);

    const owner = await engine.owner();

    assert.ok(owner.password.length >= 16);
    assert.deepEqual(await engine.owner(), owner);
  });
});

function reply(name: string, summary = "", code = "export default 1;"): string {
  return `name: ${name}\n\`\`\`ts\n${code}\n\`\`\`\n${summary}`;
}

function setUp(replies: string[], trials: Trial[] = []) {
  const log: string[] = [];
  const asked: string[] = [];
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
  const model: ModelProvider = {
    complete: async (_system, messages: readonly Message[]) => {
      asked.push(messages[0]?.content ?? "");
      return { text: replies.shift() ?? "", usage: COST };
    },
  };
  let builds = 0;
  const builder: Builder = {
    build: async (name) => `localhost/mayfly-app-${name}:${++builds}`,
    trial: async () => trials.shift() ?? { ok: true },
  };
  const engine = createEngine({ store, deployer, identity, model, builder });
  return { engine, deployed, removed, synced, log, asked };
}

function names(objects: readonly KubeObject[] | undefined): string[] {
  return (objects ?? []).map((o) => `${o.kind}/${o.metadata.name}`);
}

function secretOf(objects: readonly KubeObject[] | undefined) {
  return objects?.find((o) => o.kind === "Secret");
}
