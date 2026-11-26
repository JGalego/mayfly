import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ConfigMap, KubeObject } from "../core/kube.ts";
import { createEngine } from "./engine.ts";
import type { Builder, Deployer, IdentitySource, Message, ModelProvider, Observer, StateStore, Trial } from "./ports.ts";
import { EMPTY_STATE, type State } from "./state.ts";

const COST = { input: 100, output: 20, thinking: 0 };
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
    assert.deepEqual(await engine.written("lunch", after.head ?? ""), { routes: "v2\n", thinking: "" });
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

  it("deploys any version that passed at the same URL, and the next change branches from it", async () => {
    const { engine, deployed } = setUp([reply("lunch", "", "v1"), reply("lunch", "", "v2"), reply("lunch", "", "v3")]);
    const first = await engine.create("split lunch bills");
    await engine.change("lunch", "add totals");

    const back = await engine.deploy("lunch", first.head ?? "");
    const branched = await engine.change("lunch", "add names");

    assert.equal(back.head, first.head);
    assert.equal(back.url, first.url);
    assert.equal(names(deployed.at(-2)).length, 3);
    assert.equal(branched.versions.at(-1)?.parent, first.head);
    assert.equal(branched.versions.length, 3);
    assert.match(back.conversation.at(-1)?.text ?? "", new RegExp(`${first.head} is running now.*split lunch bills`));
  });

  it("saves code the person edited by hand, from any version, as theirs: tried, but not running until they deploy it", async () => {
    const { engine, deployed } = setUp([reply("lunch"), reply("lunch")]);
    const first = await engine.create("split lunch bills");
    const changed = await engine.change("lunch", "add totals");

    const saved = await engine.save("lunch", first.head ?? "", "export default 2;\n", "Say two");

    const mine = saved.versions.at(-1);
    assert.partialDeepStrictEqual(mine, { parent: first.head, request: "Say two", by: { kind: "person", name: "owner@mayfly.local" }, problem: null, spent: { input: 0, output: 0, thinking: 0 } });
    assert.equal(saved.head, changed.head);
    assert.equal(deployed.length, 2);
    assert.match(saved.conversation.at(-1)?.text ?? "", /passed its trial\. Deploy it/);
    const next = await engine.save("lunch", mine?.id ?? "", "export default 3;\n", "");
    assert.equal(next.versions.at(-1)?.parent, mine?.id);
    assert.equal((await engine.deploy("lunch", mine?.id ?? "")).head, mine?.id);
    assert.equal(deployed.length, 3);
  });

  it("keeps a hand edit that fails its trial, and leaves the app as it was", async () => {
    const { engine } = setUp([reply("lunch")], [{ ok: true }, crashed]);
    const before = await engine.create("split lunch bills");

    const after = await engine.save("lunch", before.head ?? "", "throw 1;\n", "");

    assert.equal(after.head, before.head);
    assert.partialDeepStrictEqual(after.versions.at(-1), { parent: before.head, request: "Edit the code by hand", problem: "crashed" });
    assert.match(after.conversation.at(-1)?.text ?? "", /didn't pass its trial\. Your app is as it was/);
  });

  it("answers a question about an app from its code without changing it, keeping the call in the ledger as a question", async () => {
    const { engine, deployed, asked } = setUp([reply("lunch"), "It adds the bills up and splits them evenly."]);
    const before = await engine.create("split lunch bills");

    const after = await engine.ask("lunch", "How does it split?");

    assert.deepEqual([after.versions, after.head, deployed.length], [before.versions, before.head, 1]);
    assert.deepEqual(after.conversation.slice(-2).map((turn) => [turn.from, turn.text]), [["person", "How does it split?"], ["mayfly", "It adds the bills up and splits them evenly."]]);
    assert.match(asked.at(-1) ?? "", /export default 1;[\s\S]*How does it split\?/);
    assert.partialDeepStrictEqual((await engine.ledger()).at(-1), { app: "lunch", spent: COST, question: true });
    assert.deepEqual(after.spent, { input: 200, output: 40, thinking: 0 });
  });

  it("has the app's model fix the errors the app logged, and says when it logged none", async () => {
    const { engine, asked, logged } = setUp([reply("lunch"), reply("lunch")]);
    await engine.create("split lunch bills");

    await assert.rejects(engine.fix("lunch"), /lunch logged no errors to fix/);
    logged.push('2026-11-26T15:04:05Z {"time":"x","level":"info","msg":"GET / 200"}', '2026-11-26T15:04:06Z {"time":"x","level":"error","msg":"bills is not defined"}');
    const fixed = await engine.fix("lunch");

    assert.match(asked.at(-1) ?? "", /bills is not defined/);
    assert.doesNotMatch(asked.at(-1) ?? "", /GET \/ 200/);
    assert.equal(fixed.versions.length, 2);
  });

  it("sends the last request to the app's model again", async () => {
    const { engine, asked } = setUp([reply("lunch"), reply("lunch"), reply("lunch")]);
    await engine.create("split lunch bills");
    await engine.change("lunch", "add totals");

    const again = await engine.retry("lunch");

    assert.match(asked.at(-1) ?? "", /add totals/);
    assert.equal(again.versions.at(-1)?.request, "add totals");
  });

  it("puts back the version that ran before, and undoing again puts back the one undone", async () => {
    const { engine, deployed } = setUp([reply("lunch"), reply("lunch")]);
    const first = await engine.create("split lunch bills");

    await assert.rejects(engine.undo("lunch"), /no version ran before/);
    const changed = await engine.change("lunch", "add totals");
    const undone = await engine.undo("lunch");
    const redone = await engine.undo("lunch");

    assert.deepEqual([undone.head, redone.head, deployed.length], [first.head, changed.head, 4]);
  });

  it("renames an app, running it again under the new name at the same address, with its ledger", async () => {
    const { engine, deployed, removed } = setUp([reply("lunch")]);
    const before = await engine.create("split lunch bills");

    const after = await engine.rename("lunch", "bills");

    assert.deepEqual([after.name, after.url, after.head], ["bills", before.url, before.head]);
    assert.deepEqual((await engine.list()).map((app) => app.name), ["bills"]);
    assert.deepEqual(names(removed.at(-1)), names(deployed.at(-2)));
    assert.ok(names(deployed.at(-1)).every((name) => name.includes("mayfly-bills")));
    assert.deepEqual((await engine.ledger()).map((call) => call.app), ["bills"]);
    assert.match(after.conversation.at(-1)?.text ?? "", /sign in again/);
  });

  it("refuses a new name that is not usable, taken, or the same", async () => {
    const { engine } = setUp([reply("lunch"), reply("notes")]);
    await engine.create("split lunch bills");
    await engine.create("keep notes");

    await assert.rejects(engine.rename("lunch", "Lunch Bills"), /Lunch Bills can't be an app's name: use lowercase letters/);
    await assert.rejects(engine.rename("lunch", "notes"), /There is already an app called notes/);
    await assert.rejects(engine.rename("lunch", "lunch"), /lunch is already called that/);
  });

  it("refuses to save from a version it does not have, or to deploy one that failed", async () => {
    const { engine } = setUp([reply("lunch"), reply("lunch")], [crashed, { ok: true }]);
    const app = await engine.create("split lunch bills");

    await assert.rejects(engine.save("lunch", "nope", "export default 2;\n", ""), /lunch has no version nope/);
    await assert.rejects(engine.deploy("lunch", app.versions[0]?.id ?? ""), /no version .* that passed/);
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

  it("reads the logs of its own pods only", async () => {
    const { engine } = setUp([reply("lunch")]);
    await engine.create("split lunch bills");

    assert.deepEqual(await engine.logs("mayfly-lunch", "app"), ["2026-11-26T15:04:05Z mayfly-lunch app"]);
    await assert.rejects(engine.logs("someone-elses-pod", "app"), /does not read the logs/);
    await assert.rejects(engine.logs("mayfly-lunch", "app; rm -rf"), /does not read the logs/);
  });

  it("remembers which apps are the person's favourites", async () => {
    const { engine } = setUp([reply("lunch")]);
    await engine.create("split lunch bills");

    await engine.star("lunch", true);

    assert.equal((await engine.list())[0]?.starred, true);
  });

  it("refuses to change an app it does not know", async () => {
    const { engine } = setUp([]);

    await assert.rejects(engine.change("ghost", "make it blue"), /no app named ghost/);
  });

  it("counts the tokens each app spent, and all of them, including failed attempts and removed apps", async () => {
    const { engine } = setUp([reply("lunch"), reply("lunch"), reply("lunch"), reply("lunch")], [{ ok: true }, crashed, crashed, crashed]);
    await engine.create("split lunch bills");

    await engine.change("lunch", "break it");

    assert.deepEqual((await engine.list())[0]?.spent, { input: 400, output: 80, thinking: 0 });
    await engine.remove("lunch");
    assert.deepEqual(await engine.spent(), { input: 400, output: 80, thinking: 0 });
  });

  it("keeps a ledger of every call to a model: when, how long, for which app, to whom, what it spent and whether its code passed, removed apps' too", async () => {
    const { engine } = setUp([reply("lunch"), reply("lunch"), reply("lunch")], [crashed, { ok: true }, { ok: true }]);
    const before = Date.now();
    await engine.create("split lunch bills");
    await engine.change("lunch", "add a total");

    await engine.remove("lunch");

    const calls = await engine.ledger();
    assert.deepEqual(
      calls.map(({ app, provider, model, spent, passed }) => ({ app, provider, model, spent, passed })),
      [false, true, true].map((passed) => ({ app: "lunch", provider: "the test provider", model: "the test model", spent: COST, passed })),
    );
    assert.ok(calls.every((call) => call.at >= before && call.at <= Date.now()));
    assert.ok(calls.every((call) => call.took !== undefined && call.took >= 0 && call.took <= call.at - before));
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

  it("changes the owner's email and password, and tells the sign-in service once an app runs", async () => {
    const { engine, synced } = setUp([reply("lunch")]);
    const before = await engine.owner();
    await engine.changeEmail("me@home.test");
    assert.equal(synced.length, 0);
    await engine.create("split lunch bills");

    const after = await engine.newPassword();

    assert.deepEqual([after.email, after.username], ["me@home.test", "me"]);
    assert.notEqual(after.password, before.password);
    assert.equal(synced.at(-1)?.owner?.password, after.password);
    await assert.rejects(engine.changeEmail("not an email"), /does not look like an email/);
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
  /** What the app's logs say, when a test needs them to say something. */
  const logged: string[] = [];
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
    provider: "the test provider",
    complete: async (_system, messages: readonly Message[]) => {
      asked.push(messages[0]?.content ?? "");
      return { text: replies.shift() ?? "", thinking: "", usage: COST };
    },
  });
  let builds = 0;
  const builder: Builder = {
    build: async (name) => `localhost/mayfly-app-${name}:${++builds}`,
    trial: async () => trials.shift() ?? { ok: true },
  };
  const observer: Observer = {
    logs: async (pod, container) => (logged.length > 0 ? logged : [`2026-11-26T15:04:05Z ${pod} ${container}`]),
    health: async (pods) => pods.filter((pod) => pod !== "mayfly-gone").map((pod) => ({ pod, containers: [{ name: "app", state: "running", status: "Up", restarts: 0 }] })),
  };
  const engine = createEngine({ store, deployer, observer, identity, models, builder });
  return { engine, deployed, removed, synced, log, asked, logged };
}

function names(objects: readonly KubeObject[] | undefined): string[] {
  return (objects ?? []).map((o) => `${o.kind}/${o.metadata.name}`);
}

function secretOf(objects: readonly KubeObject[] | undefined) {
  return objects?.find((o) => o.kind === "Secret");
}
