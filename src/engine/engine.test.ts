import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ConfigMap, KubeObject } from "../core/kube.ts";
import { createEngine } from "./engine.ts";
import type { Builder, Deployer, IdentitySource, Message, ModelProvider, Observer, StateStore, Trial } from "./ports.ts";
import { EMPTY_STATE, type State } from "./state.ts";

const COST = { input: 100, output: 20 };
const crashed: Trial = { ok: false, problem: "crashed" };

describe("the engine", () => {
  it("creates an app from a description and runs it behind sign-in at a loopback URL", async () => {
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
    assert.deepEqual(synced[0]?.apps.map((app) => app.name), ["lunch"]);
  });

  it("gives each app its own port, even when the model picks a name already in use", async () => {
    const { engine } = setUp([reply("notes"), reply("notes")]);

    const first = await engine.create("keep notes");
    const second = await engine.create("keep other notes");

    assert.equal(second.name, "notes-2");
    assert.notEqual(first.url, second.url);
  });

  it("keeps the conversation: what the person asked, and what the model said with the version it made", async () => {
    const { engine } = setUp([reply("lunch", "Splits bills and shows who owes whom.")]);

    const app = await engine.create("split lunch bills");

    assert.partialDeepStrictEqual(app.conversation[0], { from: "person", text: "split lunch bills" });
    assert.partialDeepStrictEqual(app.conversation[1], { from: "mayfly", text: "Splits bills and shows who owes whom.", versions: [app.head] });
  });

  it("keeps every attempt as a version, failed ones too, each starting from the one it repairs", async () => {
    const { engine } = setUp([reply("lunch"), reply("lunch")], [crashed, { ok: true }]);

    const app = await engine.create("split lunch bills");

    const [failed, passed] = app.versions;
    assert.deepEqual([failed?.problem, passed?.problem], ["crashed", null]);
    assert.deepEqual([failed?.parent, passed?.parent], [null, failed?.id]);
    assert.equal(app.head, passed?.id);
  });

  it("changes an app from its running code, at the same URL and with the same secrets", async () => {
    const { engine, deployed, asked } = setUp([reply("lunch", "Made it.", "v1"), reply("whatever", "Added totals.", "v2")]);
    const before = await engine.create("split lunch bills");

    const after = await engine.change("lunch", "add a monthly total");

    assert.match(asked.at(-1) ?? "", /v1/);
    assert.equal(after.url, before.url);
    assert.deepEqual(secretOf(deployed[1]), secretOf(deployed[0]));
    assert.equal(after.versions[1]?.parent, before.head);
    assert.equal(await engine.code("lunch", after.head ?? ""), "v2\n");
    assert.equal(after.versions[1]?.lines, 1);
  });

  it("leaves a running app as it was when every attempt at a change fails, and says so", async () => {
    const { engine, deployed } = setUp([reply("lunch"), reply("lunch"), reply("lunch"), reply("lunch")], [{ ok: true }, crashed, crashed, crashed]);
    const before = await engine.create("split lunch bills");

    const after = await engine.change("lunch", "break it");

    assert.equal(after.head, before.head);
    assert.equal(after.versions.length, 4);
    assert.match(after.conversation.at(-1)?.text ?? "", /as it was.*crashed/s);
    assert.equal(deployed.length, 1);
  });

  it("keeps a new app whose every attempt failed, without running it, so the person can carry on", async () => {
    const { engine, deployed, removed } = setUp([reply("lunch"), reply("lunch"), reply("lunch")], [crashed, crashed, crashed]);

    const app = await engine.create("split lunch bills");
    await engine.remove("lunch");

    assert.equal(app.head, null);
    assert.equal(app.versions.length, 3);
    assert.deepEqual([deployed.length, removed.length], [0, 0]);
  });

  it("goes back to an earlier version at the same URL, and the next change branches from it", async () => {
    const { engine, deployed } = setUp([reply("lunch", "", "v1"), reply("lunch", "", "v2"), reply("lunch", "", "v3")]);
    const first = await engine.create("split lunch bills");
    await engine.change("lunch", "add totals");

    const back = await engine.restore("lunch", first.head ?? "");
    const branched = await engine.change("lunch", "add names");

    assert.equal(back.head, first.head);
    assert.equal(back.url, first.url);
    assert.equal(names(deployed.at(-2)).length, 3);
    assert.equal(branched.versions.at(-1)?.parent, first.head);
    assert.equal(branched.versions.length, 3);
    assert.match(back.conversation.at(-1)?.text ?? "", /split lunch bills/);
  });

  it("runs code the person edited by hand as their version, starting from the running one", async () => {
    const { engine, deployed } = setUp([reply("lunch")]);
    const before = await engine.create("split lunch bills");

    const after = await engine.edit("lunch", "export default 2;\n", "Say two");

    const mine = after.versions.at(-1);
    assert.partialDeepStrictEqual(mine, { parent: before.head, request: "Say two", by: { kind: "person", name: "owner@mayfly.local" }, problem: null, spent: { input: 0, output: 0 } });
    assert.equal(after.head, mine?.id);
    assert.deepEqual(before.versions[0]?.by, { kind: "model", name: "the test model" });
    assert.equal(deployed.length, 2);
  });

  it("keeps a hand edit that fails its trial, and leaves the app as it was", async () => {
    const { engine } = setUp([reply("lunch")], [{ ok: true }, crashed]);
    const before = await engine.create("split lunch bills");

    const after = await engine.edit("lunch", "throw 1;\n", "");

    assert.equal(after.head, before.head);
    assert.partialDeepStrictEqual(after.versions.at(-1), { request: "Edit the code by hand", problem: "crashed" });
    assert.match(after.conversation.at(-1)?.text ?? "", /didn't pass its trial\. Your app is as it was/);
  });

  it("refuses to go back to a version that failed", async () => {
    const { engine } = setUp([reply("lunch"), reply("lunch")], [crashed, { ok: true }]);
    const app = await engine.create("split lunch bills");

    await assert.rejects(engine.restore("lunch", app.versions[0]?.id ?? ""), /no version .* that passed/);
  });

  it("writes each app with its own model, and keeps switching models in the conversation", async () => {
    const { engine } = setUp([reply("lunch"), reply("lunch")], [], (id) => (id === "fast" ? "Fast model" : "Careful model"));

    const made = await engine.create("split lunch bills", { model: "fast" });
    const switched = await engine.useModel("lunch", "careful");
    const changed = await engine.change("lunch", "add totals");

    assert.equal(made.model, "fast");
    assert.equal(made.versions[0]?.by.name, "Fast model");
    assert.match(switched.conversation.at(-1)?.text ?? "", /Careful model writes the changes/);
    assert.equal(changed.versions.at(-1)?.by.name, "Careful model");
  });

  it("says how each running app and the sign-in service are doing", async () => {
    const { engine } = setUp([reply("lunch"), reply("notes"), reply("notes"), reply("notes")], [{ ok: true }, crashed, crashed, crashed]);
    await engine.create("split lunch bills");
    await engine.create("keep notes");

    const health = await engine.health();

    assert.deepEqual(
      health.map((service) => [service.name, service.kind, service.pod, service.containers.length]),
      [
        ["lunch", "app", "mayfly-lunch", 1],
        ["Sign-in", "sign-in", "mayfly-dex", 1],
      ],
    );
  });

  it("refuses to change an app it does not know", async () => {
    const { engine } = setUp([]);

    await assert.rejects(engine.change("ghost", "make it blue"), /no app named ghost/);
  });

  it("counts the tokens each app spent, and all of them, including failed attempts and removed apps", async () => {
    const { engine } = setUp([reply("lunch"), reply("lunch"), reply("lunch"), reply("lunch")], [{ ok: true }, crashed, crashed, crashed]);
    await engine.create("split lunch bills");

    await engine.change("lunch", "break it");

    assert.deepEqual((await engine.list())[0]?.spent, { input: 400, output: 80 });
    await engine.remove("lunch");
    assert.deepEqual(await engine.spent(), { input: 400, output: 80 });
  });

  it("says when it starts the app, after the model's code passed its trial", async () => {
    const { engine } = setUp([reply("lunch")]);
    const steps: string[] = [];

    await engine.create("split lunch bills", { watch: (step) => steps.push(step.kind) });

    assert.deepEqual(steps, ["writing", "wrote", "building", "trying", "deploying"]);
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
    assert.deepEqual(synced.at(-1)?.apps.map((app) => app.name), ["notes"]);
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

function setUp(replies: string[], trials: Trial[] = [], named: (id: string | null) => string = () => "the test model") {
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
    pod: "mayfly-dex",
    sync: async (next) => void (log.push("sync"), synced.push(next)),
    settingsFor: () => ({ OAUTH2_PROXY_CLIENT_ID: "fake" }),
  };
  const models = (id: string | null): ModelProvider => ({
    name: named(id),
    complete: async (_system, messages: readonly Message[]) => {
      asked.push(messages[0]?.content ?? "");
      return { text: replies.shift() ?? "", usage: COST };
    },
  });
  let builds = 0;
  const builder: Builder = {
    build: async (name) => `localhost/mayfly-app-${name}:${++builds}`,
    trial: async () => trials.shift() ?? { ok: true },
  };
  const observer: Observer = {
    health: async (pods) => pods.filter((pod) => pod !== "mayfly-gone").map((pod) => ({ pod, containers: [{ name: "app", state: "running", status: "Up", restarts: 0 }] })),
  };
  const engine = createEngine({ store, deployer, observer, identity, models, builder });
  return { engine, deployed, removed, synced, log, asked };
}

function names(objects: readonly KubeObject[] | undefined): string[] {
  return (objects ?? []).map((o) => `${o.kind}/${o.metadata.name}`);
}

function secretOf(objects: readonly KubeObject[] | undefined) {
  return objects?.find((o) => o.kind === "Secret");
}
