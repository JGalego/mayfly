import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ConfigMap, KubeObject, Pod } from "../core/kube.ts";
import { createEngine, RecordedFailure } from "./engine.ts";
import { PortTaken, type Builder, type Deployer, type FileStore, type IdentitySource, type Message, type ModelProvider, type Observer, type PhoneNetwork, type PhoneNetworkStatus, type StateStore, type Trial } from "./ports.ts";
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
    assert.match(after.conversation.at(-1)?.text ?? "", /Previous deployment unchanged\..*crashed/s);
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
    assert.deepEqual(back.conversation.slice(-2).map((turn) => turn.text.split(":")[0]), [`Deploy version \`${first.head}\``, `Deployed version \`${first.head}\``]);
    assert.match(back.conversation.at(-1)?.text ?? "", /split lunch bills/);
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
    assert.match(saved.conversation.at(-1)?.text ?? "", /Trial passed\. Deploy to run this version/);
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
    assert.partialDeepStrictEqual(after.versions.at(-1), { parent: before.head, request: "Manual edit", problem: "crashed" });
    assert.match(after.conversation.at(-1)?.text ?? "", /Trial failed\. Previous deployment unchanged/);
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

    await assert.rejects(engine.undo("lunch"), /no previous deployment/);
    const changed = await engine.change("lunch", "add totals");
    const undone = await engine.undo("lunch");
    const redone = await engine.undo("lunch");

    assert.deepEqual([undone.head, redone.head, deployed.length], [first.head, changed.head, 4]);
  });

  it("renames an app, running it again under the new name at the same address, with its ledger", async () => {
    const { engine, deployed, removed, forgotten } = setUp([reply("lunch")]);
    const before = await engine.create("split lunch bills");

    const after = await engine.rename("lunch", "bills");

    assert.deepEqual([after.name, after.url, after.head], ["bills", before.url, before.head]);
    assert.deepEqual((await engine.list()).map((app) => app.name), ["bills"]);
    assert.deepEqual(names(removed.at(-1)), names(deployed.at(-2)));
    assert.ok(names(deployed.at(-1)).every((name) => name.includes("mayfly-bills")));
    assert.deepEqual(forgotten, ["lunch"]);
    assert.deepEqual((await engine.ledger()).map((call) => call.app), ["bills"]);
    assert.deepEqual(after.conversation.slice(-2).map((turn) => turn.text.split(".")[0]), ["Rename to `bills`", "Renamed `lunch` to `bills`"]);
    assert.match(after.conversation.at(-1)?.text ?? "", /Sign in again/);
  });

  it("refuses a new name that is not usable, taken, or the same", async () => {
    const { engine } = setUp([reply("lunch"), reply("notes")]);
    await engine.create("split lunch bills");
    await engine.create("keep notes");

    await assert.rejects(engine.rename("lunch", "Lunch Bills"), /Lunch Bills can't be an app's name: use lowercase letters/);
    await assert.rejects(engine.rename("lunch", "notes"), /There is already an app called notes/);
    await assert.rejects(engine.rename("lunch", "lunch"), /lunch is already called that/);
  });

  it("starts the running version again, with the sign-in service, changing nothing about the app", async () => {
    const { engine, deployed, synced } = setUp([reply("lunch")]);
    const before = await engine.create("split lunch bills");

    const started = await engine.start("lunch");

    assert.deepEqual([started.head, started.versions, started.conversation], [before.head, before.versions, before.conversation]);
    assert.deepEqual(names(deployed.at(-1)), names(deployed.at(-2)));
    assert.equal(synced.length, 2);
  });

  it("names the apps that have a version to run but that Podman is not running", async () => {
    const { engine } = setUp([reply("lunch"), reply("gone"), reply("never"), reply("never"), reply("never")], [{ ok: true }, { ok: true }, crashed, crashed, crashed]);
    await engine.create("split lunch bills");
    await engine.create("an app Podman has lost");
    await engine.create("an app that never ran");

    assert.deepEqual(await engine.stopped(), ["gone"]);
  });

  it("refuses to start an app that has never run", async () => {
    const { engine } = setUp([reply("lunch"), reply("lunch"), reply("lunch")], [crashed, crashed, crashed]);
    await engine.create("split lunch bills");

    await assert.rejects(engine.start("lunch"), /lunch has no deployed version to start/);
  });

  it("sends attached files with a request, keeps them apart from the state and in the conversation by name, and sends them again on retry", async () => {
    const { engine, asked, kept } = setUp([reply("lunch"), reply("lunch"), reply("lunch")]);
    await engine.create("split lunch bills");
    const csv = { name: "bills.csv", type: "text/csv", data: new TextEncoder().encode("who,amount") };
    const png = { name: "mockup.png", type: "image/png", data: new Uint8Array([1, 2, 3]) };

    const changed = await engine.change("lunch", "use these", undefined, [csv, png]);

    assert.match(asked.at(-1) ?? "", /use these[\s\S]*bills\.csv:[\s\S]*who,amount[\s\S]*an image: mockup\.png[\s\S]*\[image\/png\]/);
    const request = changed.conversation.at(-2);
    const attached = request?.from === "person" ? (request.attachments ?? []) : [];
    assert.deepEqual(attached.map((file) => [file.name, file.type, file.bytes]), [["bills.csv", "text/csv", 10], ["mockup.png", "image/png", 3]]);
    assert.equal(kept.size, 2);
    assert.deepEqual([...(await engine.attachment("lunch", attached[1]?.id ?? "")).data], [1, 2, 3]);
    await assert.rejects(engine.attachment("lunch", "0".repeat(64)), /lunch has no file 0+/);
    await engine.retry("lunch");
    assert.match(asked.at(-1) ?? "", /who,amount/);
  });

  it("keeps a request that failed in the conversation, with why, and sends it again on retry", async () => {
    const { engine } = setUp([reply("lunch"), new Error("The model's service is down."), reply("lunch")]);
    await engine.create("split lunch bills");

    await assert.rejects(engine.change("lunch", "add totals"), (error) => error instanceof RecordedFailure && error.message === "The model's service is down.");
    const [app] = await engine.list();
    const retried = await engine.retry("lunch");

    assert.deepEqual(
      app?.conversation.slice(-2).map((turn) => [turn.from, turn.text, turn.from === "mayfly" && turn.failed === true]),
      [
        ["person", "add totals", false],
        ["mayfly", "The model's service is down.", true],
      ],
    );
    assert.equal(retried.versions.at(-1)?.request, "add totals");
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
    assert.match(switched.conversation.at(-1)?.text ?? "", /Model set to Careful model/);
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

  it("stops, unregisters and forgets an app it removes, images and all", async () => {
    const { engine, deployed, removed, synced, forgotten, log } = setUp([reply("lunch"), reply("notes")]);
    await engine.create("split lunch bills");
    await engine.create("keep notes");

    await engine.remove("lunch");

    assert.deepEqual(names(removed[0]), names(deployed[0]));
    assert.deepEqual(forgotten, ["lunch"]);
    assert.deepEqual(synced.at(-1)?.apps.map((app) => app.name), ["notes"]);
    assert.ok(!log.includes("stop"));
    assert.deepEqual(
      (await engine.list()).map((app) => app.name),
      ["notes"],
    );
  });

  it("stops the sign-in service with the last running app, and stops reporting on it", async () => {
    const { engine, log } = setUp([reply("lunch"), reply("notes"), reply("notes"), reply("notes")], [{ ok: true }, crashed, crashed, crashed]);
    await engine.create("split lunch bills");
    await engine.create("keep notes");

    await engine.remove("lunch");

    assert.equal(log.at(-1), "stop");
    assert.deepEqual(await engine.health(), []);
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
    await assert.rejects(engine.changeEmail("not an email"), /Enter a valid email address/);
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

/** What the model was asked, as text, with any image as its media type. */
function textOf(content: Message["content"]): string {
  return typeof content === "string" ? content : content.map((part) => (part.type === "text" ? part.text : `[${part.mediaType}]`)).join("\n");
}

// A reply, or an error the model's service fails with instead.
describe("work that passed but couldn't run", () => {
  const TAKEN = "Port 18100 on this computer is in use by another program. Stop that program, then try again.";

  it("keeps a new app whole, says why it didn't start, and runs it on Start once that's fixed", async () => {
    const { engine, deployed, deployFailures } = setUp([reply("lunch")]);
    deployFailures.push(TAKEN);

    await assert.rejects(engine.create("split lunch bills"), (error: unknown) => error instanceof RecordedFailure && error.app === "lunch");
    const [kept] = await engine.list();
    assert.equal(kept?.versions.length, 1);
    assert.equal(kept?.head, kept?.versions[0]?.id);
    assert.deepEqual(kept?.conversation.map((turn) => turn.from), ["person", "mayfly"]);
    assert.match(kept?.conversation.at(-1)?.text ?? "", /didn't start: Port 18100 .*Choose Start/s);
    const said = kept?.conversation.at(-1);
    assert.ok(said?.from === "mayfly" && said.failed === true);
    assert.deepEqual((await engine.ledger()).map((call) => call.app), ["lunch"]);

    await engine.start("lunch");
    assert.equal(deployed.length, 1);
  });

  it("keeps a change that passed but couldn't run, with the version before it to go back to", async () => {
    const { engine, deployFailures } = setUp([reply("lunch", "", "v1"), reply("lunch", "", "v2")]);
    const before = await engine.create("split lunch bills");
    deployFailures.push(TAKEN);

    await assert.rejects(engine.change("lunch", "add totals"), RecordedFailure);
    const [kept] = await engine.list();
    assert.equal(kept?.versions.length, 2);
    assert.notEqual(kept?.head, before.head);
    assert.match(kept?.conversation.at(-1)?.text ?? "", /didn't start/);
  });
});

describe("sign-in on a port another program holds", () => {
  it("moves to the next port free, runs the app with it, and stays there", async () => {
    const { engine, deployed, synced, takenPorts } = setUp([reply("lunch"), reply("lunch")]);
    takenPorts.add(5556);

    await engine.create("split lunch bills");
    takenPorts.clear();
    await engine.change("lunch", "add totals");

    assert.equal(synced.at(-1)?.signInPort, 5557);
    assert.deepEqual(deployed.map(loginUrlOf).at(-1), "http://localhost:5557/dex/auth");
  });

  it("takes the running apps along, since they send people to it", async () => {
    const { engine, deployed, takenPorts } = setUp([reply("lunch"), reply("notes")]);
    await engine.create("split lunch bills");
    takenPorts.add(5556);

    await engine.create("keep notes");

    const lunch = deployed.filter((objects) => containersOf(objects).length > 0 && names(objects).includes("Pod/mayfly-lunch"));
    assert.deepEqual(lunch.map(loginUrlOf), ["http://localhost:5556/dex/auth", "http://localhost:5557/dex/auth"]);
  });

  it("moves the phone's way to sign in along with it", async () => {
    const { engine, served, takenPorts } = setUp([reply("lunch")]);
    await engine.turnOnPhone();
    takenPorts.add(5556);

    await engine.create("split lunch bills");

    assert.deepEqual(served, new Map([[25557, 5557], [38100, 28100]]));
  });
});

function loginUrlOf(objects: readonly KubeObject[]): string | undefined {
  return objects.find((o): o is ConfigMap => o.kind === "ConfigMap")?.data.OAUTH2_PROXY_LOGIN_URL;
}

describe("phone access", () => {
  it("is off until turned on", async () => {
    const { engine } = setUp([]);

    assert.equal(await engine.phoneAccess(), null);
  });

  it("refuses to turn on until the private network is ready, saying what to do, and changes nothing", async () => {
    const { engine, served } = setUp([], [], undefined, { state: "no-https" });

    await assert.rejects(engine.turnOnPhone(), /Enable HTTPS/);
    assert.equal(await engine.phoneAccess(), null);
    assert.deepEqual(served, new Map());
  });

  it("says which Windows user holds Tailscale, and what to do about it", async () => {
    const { engine } = setUp([], [], undefined, { state: "other-user", user: "CRITICAL\\jpgalego" });

    await assert.rejects(engine.turnOnPhone(), /in use by another Windows user \(CRITICAL\\jpgalego\)\. Run Podman Desktop as that user/);
  });

  it("passes on what Tailscale said when Mayfly can't tell how it is", async () => {
    const { engine } = setUp([], [], undefined, { state: "failed", reason: "Access denied." });

    await assert.rejects(engine.turnOnPhone(), /Tailscale.*Access denied\./);
  });

  it("turns on by serving sign-in and each running app's phone door, and running the apps with it", async () => {
    const { engine, served, deployed, synced } = setUp([reply("lunch"), reply("notes"), reply("notes"), reply("notes")], [{ ok: true }, crashed, crashed, crashed]);
    await engine.create("split lunch bills");
    await engine.create("keep notes");

    const host = await engine.turnOnPhone();

    assert.equal(host, "mayfly.tail1a2b.ts.net");
    assert.equal(await engine.phoneAccess(), host);
    assert.deepEqual(served, new Map([[25556, 5556], [38100, 28100]]));
    assert.deepEqual(containersOf(deployed.at(-1)), ["auth-proxy", "phone-door", "app"]);
    assert.equal(synced.at(-1)?.phoneHost, host);
  });

  it("gives an app made while it's on a phone door from the start", async () => {
    const { engine, served, deployed } = setUp([reply("lunch")]);
    await engine.turnOnPhone();

    await engine.create("split lunch bills");

    assert.deepEqual(served, new Map([[25556, 5556], [38100, 28100]]));
    assert.deepEqual(containersOf(deployed.at(-1)), ["auth-proxy", "phone-door", "app"]);
  });

  it("stops serving a removed app's port, and sign-in's with the last app", async () => {
    const { engine, served } = setUp([reply("lunch")]);
    await engine.turnOnPhone();
    await engine.create("split lunch bills");

    await engine.remove("lunch");

    assert.deepEqual(served, new Map());
  });

  it("turns off by serving nothing and running the apps through their localhost door only", async () => {
    const { engine, served, deployed } = setUp([reply("lunch")]);
    await engine.turnOnPhone();
    await engine.create("split lunch bills");

    await engine.turnOffPhone();

    assert.equal(await engine.phoneAccess(), null);
    assert.deepEqual(served, new Map());
    assert.deepEqual(containersOf(deployed.at(-1)), ["auth-proxy", "app"]);
  });
});

function containersOf(objects: readonly KubeObject[] | undefined): string[] {
  const pod = objects?.find((o): o is Pod => o.kind === "Pod");
  return pod?.spec.containers.map((c) => c.name) ?? [];
}

function setUp(replies: (string | Error)[], trials: Trial[] = [], named: (id: string | null) => string = () => "the test model", network: PhoneNetworkStatus = { state: "ready", host: "mayfly.tail1a2b.ts.net" }) {
  const log: string[] = [];
  const asked: string[] = [];
  /** What the app's logs say, when a test needs them to say something. */
  const logged: string[] = [];
  const deployed: (readonly KubeObject[])[] = [];
  const removed: (readonly KubeObject[])[] = [];
  const synced: State[] = [];
  /** Apps whose images were removed, by name. */
  const forgotten: string[] = [];
  let state: State = EMPTY_STATE;
  const store: StateStore = {
    load: async () => state,
    save: async (next) => void (state = next),
  };
  /** Why the next deploys fail, one reason each, as when something else holds a port. */
  const deployFailures: string[] = [];
  const deployer: Deployer = {
    deploy: async (objects) => {
      const failure = deployFailures.shift();
      if (failure !== undefined) throw new Error(failure);
      log.push("deploy");
      deployed.push(objects);
    },
    remove: async (objects) => void (log.push("remove"), removed.push(objects)),
  };
  /** Ports another program holds, where Dex can't listen. */
  const takenPorts = new Set<number>();
  const identity: IdentitySource = {
    pod: "mayfly-dex",
    preferredPort: 5556,
    sync: async (next, port) => {
      if (takenPorts.has(port)) throw new PortTaken(port);
      log.push("sync");
      synced.push(next);
    },
    stop: async () => void log.push("stop"),
    settingsFor: (_app, port) => ({
      proxy: { OAUTH2_PROXY_CLIENT_ID: "fake", OAUTH2_PROXY_LOGIN_URL: `http://localhost:${port}/dex/auth` },
      endSessionUrl: `http://localhost:${port}/dex/logout`,
    }),
  };
  const models = (id: string | null): ModelProvider => ({
    name: named(id),
    provider: "the test provider",
    complete: async (_system, messages: readonly Message[]) => {
      asked.push(textOf(messages[0]?.content ?? ""));
      const next = replies.shift() ?? "";
      if (next instanceof Error) throw next;
      return { text: next, thinking: "", usage: COST };
    },
  });
  let builds = 0;
  const builder: Builder = {
    build: async (name) => `localhost/mayfly-app-${name}:${++builds}`,
    trial: async () => trials.shift() ?? { ok: true },
    forget: async (name) => void forgotten.push(name),
  };
  const observer: Observer = {
    logs: async (pod, container) => (logged.length > 0 ? logged : [`2026-11-26T15:04:05Z ${pod} ${container}`]),
    health: async (pods) => pods.filter((pod) => pod !== "mayfly-gone").map((pod) => ({ pod, containers: [{ name: "app", state: "running", status: "Up", restarts: 0 }] })),
  };
  // Attached files, kept by their hash.
  const kept = new Map<string, Uint8Array>();
  const files: FileStore = {
    put: async (data) => {
      const id = createHash("sha256").update(data).digest("hex");
      kept.set(id, data);
      return id;
    },
    get: async (id) => kept.get(id) ?? Promise.reject(new Error(`no file ${id}`)),
  };
  // What the private network serves for the phone: each port, and the loopback port it forwards to.
  const served = new Map<number, number>();
  const phoneNetwork: PhoneNetwork = {
    status: async () => network,
    serve: async (port, to) => void served.set(port, to),
    stop: async (port) => void served.delete(port),
  };
  const engine = createEngine({ store, deployer, observer, identity, models, builder, files, phoneNetwork });
  return { engine, deployed, removed, synced, forgotten, served, log, asked, logged, kept, deployFailures, takenPorts };
}

function names(objects: readonly KubeObject[] | undefined): string[] {
  return (objects ?? []).map((o) => `${o.kind}/${o.metadata.name}`);
}

function secretOf(objects: readonly KubeObject[] | undefined) {
  return objects?.find((o) => o.kind === "Secret");
}
