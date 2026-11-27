import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RecordedFailure, type AppView, type Engine, type PhoneView } from "../../engine/engine.ts";
import type { ModelCall } from "../../engine/state.ts";
import type { Step, Watcher } from "../../engine/step.ts";
import { createController } from "./controller.ts";
import type { Examination } from "./doctor.ts";
import type { MailAccount, Outgoing } from "./mail-account.ts";
import type { ToUi } from "./messages.ts";
import type { Models, ModelSetting } from "./settings.ts";

const lunch: AppView = {
  name: "lunch-split",
  url: "http://localhost:18100/",
  conversation: [{ from: "person", text: "split lunch bills", at: 0 }],
  model: "openai",
  starred: false,
  head: "v1",
  versions: [],
  spent: { input: 100, output: 20, thinking: 0 },
  people: [],
};
const owner = { email: "owner@mayfly.local", username: "owner", password: "s3cret-pass" };
const openai: ModelSetting = { id: "openai", provider: "openai", baseUrl: "", model: "gpt-6.2-sol" };
const local: ModelSetting = { id: "", provider: "openai-compatible", baseUrl: "http://localhost:11434/v1", model: "qwen3" };
const OPENAI_ENDPOINT = "https://api.openai.com/v1";
const writing: Step = { kind: "writing", attempt: 1 };
const draft = (text: string): Step => ({ kind: "draft", text });
const call: ModelCall = { at: 1, app: "lunch-split", provider: "OpenAI", model: "OpenAI · gpt-6.2-sol", spent: { input: 500, output: 80, thinking: 0 } };
const thinking = (text: string): Step => ({ kind: "thinking", text });
// How long the fake model takes to answer, so the answer is still coming when the page is sent it.
const ANSWER_MS = 1000;

describe("the Mayfly panel's controller", () => {
  it("shows the apps, who signs in, the models and whether their keys are saved, and the tokens spent", async () => {
    const { handle, posted } = setUp({ apps: [lunch] });

    await handle({ type: "ready" });

    assert.deepEqual(posted.at(-1), {
      type: "state",
      apps: [lunch],
      owner: owner.email,
      people: [],
      models: [{ ...openai, label: "OpenAI · gpt-6.2-sol", hasApiKey: true }],
      defaultModel: "openai",
      spent: { input: 500, output: 80, thinking: 0 },
      working: null,
      developer: false,
      autostart: false,
      phoneHost: null,
      mail: null,
      phoneCreation: false,
      phones: [],
    });
  });

  it("makes a new app, showing the work while it runs, then shows the app and opens it", async () => {
    const { handle, posted, opened, calls } = setUp({ apps: [] });

    await handle({ type: "send", app: null, request: " split lunch bills " });

    assert.deepEqual(calls, ["create split lunch bills with openai"]);
    assert.partialDeepStrictEqual(stateOf(posted[0])?.working, { app: null, request: "split lunch bills", kind: "create", steps: [] });
    assert.equal(stateOf(posted[1])?.working, null);
    assert.deepEqual(posted[2], { type: "created", name: "lunch-split" });
    assert.deepEqual(opened, [lunch.url]);
  });

  it("shows each step of the work as it happens", async () => {
    const { handle, posted } = setUp({ apps: [], steps: [writing, { kind: "wrote", routes: "x" }] });

    await handle({ type: "send", app: null, request: "split lunch bills" });

    const progress = posted.flatMap((m) => (m.type === "progress" ? [m.working.steps.map((s) => s.kind)] : []));
    assert.deepEqual(progress, [["writing"], ["writing", "wrote"]]);
  });

  it("passes on the model's latest draft a few times a second to a developer", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { handle, posted, finish } = setUp({ apps: [], steps: [writing, draft("a"), draft("ab"), draft("abc")], developer: true, waitForCreate: true });

    const sending = handle({ type: "send", app: null, request: "split lunch bills" });
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(150);
    finish();
    await sending;

    const progress = posted.flatMap((m) => (m.type === "progress" ? [m.working.steps] : []));
    assert.deepEqual(progress, [[writing], [writing, draft("abc")]]);
  });

  it("passes on the model's latest thinking with its draft, keeping the thinking once the draft starts", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const steps = [writing, thinking("a"), thinking("a list"), draft("n"), draft("name")];
    const { handle, posted, finish } = setUp({ apps: [], steps, developer: true, waitForCreate: true });

    const sending = handle({ type: "send", app: null, request: "split lunch bills" });
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(150);
    finish();
    await sending;

    const progress = posted.flatMap((m) => (m.type === "progress" ? [m.working.steps] : []));
    assert.deepEqual(progress, [[writing], [writing, thinking("a list"), draft("name")]]);
  });

  it("keeps the draft to itself when developer mode is off", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { handle, posted } = setUp({ apps: [], steps: [writing, draft("a")] });

    await handle({ type: "send", app: null, request: "split lunch bills" });
    t.mock.timers.tick(150);

    assert.equal(posted.filter((m) => m.type === "progress").length, 1);
  });

  it("answers a question about an app, showing the answer as it comes even with developer mode off, and refuses an empty one", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { handle, posted, calls } = setUp({ apps: [lunch], steps: [draft("It adds")] });

    const asking = handle({ type: "ask", app: "lunch-split", question: " How does it split? " });
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(150);
    const streamed = posted.some((m) => m.type === "progress" && m.working.steps.at(-1)?.kind === "draft");
    t.mock.timers.tick(ANSWER_MS);
    await asking;
    await handle({ type: "ask", app: "lunch-split", question: "  " });

    assert.deepEqual(calls, ["ask lunch-split How does it split?"]);
    assert.equal(stateOf(posted[0])?.working?.kind, "ask");
    assert.ok(streamed);
    assert.equal(posted.at(-1)?.type, "error");
  });

  it("fixes, retries, undoes and starts, showing each as work while it runs, as the command that asked for it", async () => {
    const { handle, posted, calls } = setUp({ apps: [lunch] });

    for (const type of ["fix", "retry", "undo", "start"] as const) await handle({ type, app: "lunch-split" });

    assert.deepEqual(calls, ["fix lunch-split", "retry lunch-split", "undo lunch-split", "start lunch-split"]);
    assert.deepEqual(
      posted.flatMap((m) => stateOf(m)?.working?.kind ?? []),
      ["change", "change", "deploy", "start"],
    );
    assert.deepEqual(
      posted.flatMap((m) => stateOf(m)?.working?.request ?? []),
      ["/fix", "/retry", "/undo", "/start"],
    );
  });

  it("renames an app, telling the page its new name before the state without the old one", async () => {
    const { handle, posted, calls } = setUp({ apps: [lunch] });

    await handle({ type: "rename", app: "lunch-split", name: " bills " });

    assert.deepEqual(calls, ["rename lunch-split bills"]);
    assert.equal(stateOf(posted[0])?.working?.kind, "rename");
    assert.deepEqual(posted.at(-2), { type: "renamed", from: "lunch-split", to: "bills" });
    assert.equal(stateOf(posted.at(-1))?.working, null);
  });

  it("deploys a version, showing the work while it runs", async () => {
    const { handle, posted, calls } = setUp({ apps: [lunch] });

    await handle({ type: "deploy", app: "lunch-split", version: "v1" });

    assert.deepEqual(calls, ["deploy lunch-split v1"]);
    assert.equal(stateOf(posted[0])?.working?.kind, "deploy");
    assert.equal(stateOf(posted.at(-1))?.working, null);
  });

  it("saves code edited by hand from a version, and refuses empty code", async () => {
    const { handle, posted, calls } = setUp({ apps: [lunch] });

    await handle({ type: "save", app: "lunch-split", from: "v1", routes: "export default 2;\n", message: " Say two " });
    await handle({ type: "save", app: "lunch-split", from: "v1", routes: "  ", message: "" });

    assert.deepEqual(calls, ["save lunch-split v1 export default 2; Say two"]);
    assert.equal(stateOf(posted[0])?.working?.kind, "save");
    assert.deepEqual(posted.find((m) => m.type === "saved"), { type: "saved", app: "lunch-split", version: "v2" });
    assert.equal(posted.at(-1)?.type, "error");
  });

  it("says how the apps and the sign-in service are doing", async () => {
    const { handle, posted } = setUp({ apps: [lunch] });

    await handle({ type: "health" });

    assert.deepEqual(posted, [{ type: "health", services: [{ name: "lunch-split", kind: "app", pod: "mayfly-lunch-split", containers: [] }] }]);
  });

  it("keeps what it did in an activity log, and passes on a container's logs", async () => {
    const { handle, posted } = setUp({ apps: [lunch], createFails: "The model's service is down." });

    await handle({ type: "send", app: "lunch-split", request: "add totals" });
    await handle({ type: "send", app: null, request: "keep notes" });
    await handle({ type: "activity" });
    await handle({ type: "logs", pod: "mayfly-lunch-split", container: "app" });

    const activity = posted.find((m) => m.type === "activity");
    assert.deepEqual(
      activity?.type === "activity" ? activity.entries.map((entry) => [entry.level, entry.text]) : [],
      [
        ["info", "Started: add totals"],
        ["info", "Changed lunch-split"],
        ["info", "Started: keep notes"],
        ["error", "The model's service is down."],
      ],
    );
    assert.deepEqual(posted.at(-1), { type: "logs", pod: "mayfly-lunch-split", container: "app", lines: ["2026-11-26T15:04:05Z mayfly-lunch-split app"] });
  });

  it("passes on what the doctor tells as it checks", async () => {
    const { handle, posted } = setUp({ apps: [] });

    await handle({ type: "doctor" });

    assert.deepEqual(posted, [{ type: "doctor", ready: [{ name: "Podman", status: "pass", detail: "Podman 5.8.9 is running" }], models: [{ id: "openai", status: "pass", detail: "Ready" }] }]);
  });

  it("changes the owner's email, and copies a new password without sending it to the page", async () => {
    const { handle, calls, copied, posted } = setUp({ apps: [] });

    await handle({ type: "owner-email", email: "me@home.test" });
    await handle({ type: "new-password" });

    assert.deepEqual(calls, ["email me@home.test"]);
    assert.deepEqual(copied, ["brand-new-pass"]);
    assert.ok(!JSON.stringify(posted).includes("brand-new-pass"));
  });

  it("marks an app as a favourite", async () => {
    const { handle, calls, posted } = setUp({ apps: [lunch] });

    await handle({ type: "star", app: "lunch-split", starred: true });

    assert.deepEqual(calls, ["star lunch-split true"]);
    assert.equal(posted.at(-1)?.type, "state");
  });

  it("sends the code of a version the page asks for, and the model's thinking", async () => {
    const { handle, posted } = setUp({ apps: [lunch] });

    await handle({ type: "code", app: "lunch-split", version: "v1" });

    assert.deepEqual(posted, [{ type: "code", app: "lunch-split", version: "v1", routes: "export default 1;\n", thinking: "One route will do." }]);
  });

  it("sends the ledger of model calls when the page asks for it", async () => {
    const { handle, posted } = setUp({ apps: [] });

    await handle({ type: "ledger" });

    assert.deepEqual(posted, [{ type: "ledger", calls: [call] }]);
  });

  it("remembers whether developer mode is on", async () => {
    const { handle, posted } = setUp({ apps: [] });

    await handle({ type: "developer", on: true });

    assert.equal(stateOf(posted.at(-1))?.developer, true);
  });

  it("remembers whether to start stopped apps when Podman Desktop starts, off at first", async () => {
    const { handle, posted } = setUp({ apps: [] });

    await handle({ type: "ready" });
    await handle({ type: "autostart", on: true });

    assert.deepEqual([stateOf(posted.at(-2))?.autostart, stateOf(posted.at(-1))?.autostart], [false, true]);
  });

  describe("making apps from the phone", () => {
    const phones = [
      { id: "a1b2c3d4", name: "iPhone", pairedAt: 1 },
      { id: "e5f6a7b8", name: "iPad", pairedAt: 2 },
    ];

    it("turns on only once phone access is on, serving the phone page", async () => {
      const { handle, posted, calls } = setUp({ apps: [lunch] });

      await handle({ type: "phone-creation", on: true });
      const refused = posted.at(-1);
      await handle({ type: "phone", on: true });
      await handle({ type: "phone-creation", on: true });

      assert.deepEqual(refused, { type: "error", text: "Turn on phone access first." });
      assert.deepEqual(calls, ["turn on phone", "serve the phone page"]);
      assert.equal(stateOf(posted.at(-1))?.phoneCreation, true);
    });

    it("turns off by stopping the phone page and forgetting every paired phone", async () => {
      const { handle, posted, calls } = setUp({ apps: [lunch], phones });
      await handle({ type: "phone", on: true });
      await handle({ type: "phone-creation", on: true });

      await handle({ type: "phone-creation", on: false });

      assert.deepEqual(calls.slice(2), ["stop the phone page", "forget phone a1b2c3d4", "forget phone e5f6a7b8"]);
      assert.deepEqual([stateOf(posted.at(-1))?.phoneCreation, stateOf(posted.at(-1))?.phones], [false, []]);
    });

    it("turns off with phone access, which the page needs", async () => {
      const { handle, posted, calls } = setUp({ apps: [lunch] });
      await handle({ type: "phone", on: true });
      await handle({ type: "phone-creation", on: true });

      await handle({ type: "phone", on: false });

      assert.deepEqual(calls.slice(2), ["stop the phone page", "turn off phone"]);
      assert.equal(stateOf(posted.at(-1))?.phoneCreation, false);
    });

    it("shows a link to pair a phone: the page on the phone's address, with a one-time code the browser never sends", async () => {
      const { handle, posted } = setUp({ apps: [lunch] });
      await handle({ type: "phone", on: true });
      await handle({ type: "phone-creation", on: true });

      await handle({ type: "pair-phone" });

      assert.deepEqual(posted.at(-1), { type: "pairing", url: "https://mayfly.tail1a2b.ts.net:38099/#pair=pairing-code", expires: 1234 });
    });

    it("pairs no phone while it's off", async () => {
      const { handle, posted } = setUp({ apps: [lunch] });
      await handle({ type: "phone", on: true });

      await handle({ type: "pair-phone" });

      assert.deepEqual(posted.at(-1), { type: "error", text: "Turn on Make apps from my phone first." });
    });

    it("lists the paired phones, and forgets one", async () => {
      const { handle, posted, calls } = setUp({ apps: [lunch], phones });
      await handle({ type: "ready" });
      const listed = stateOf(posted.at(-1))?.phones;

      await handle({ type: "forget-phone", id: "a1b2c3d4" });

      assert.deepEqual(listed, phones);
      assert.deepEqual(calls, ["forget phone a1b2c3d4"]);
      assert.deepEqual(stateOf(posted.at(-1))?.phones, [phones[1]]);
    });
  });

  it("turns phone access on, saying where the phone opens the apps, and off again", async () => {
    const { handle, posted, calls } = setUp({ apps: [lunch] });

    await handle({ type: "phone", on: true });
    const on = stateOf(posted.at(-1))?.phoneHost;
    await handle({ type: "phone", on: false });

    assert.deepEqual(calls, ["turn on phone", "turn off phone"]);
    assert.equal(on, "mayfly.tail1a2b.ts.net");
    assert.ok(posted.some((message) => message.type === "notice" && message.text.includes("mayfly.tail1a2b.ts.net")));
    assert.equal(stateOf(posted.at(-1))?.phoneHost, null);
  });

  it("says why phone access can't be turned on yet", async () => {
    const { handle, posted } = setUp({ apps: [lunch], phoneFails: "Sign in to Tailscale and try again" });

    await handle({ type: "phone", on: true });

    assert.ok(posted.some((message) => message.type === "error" && message.text === "Sign in to Tailscale and try again"));
    assert.equal(stateOf(posted.at(-1))?.phoneHost, null);
  });

  it("starts each stopped app in turn, as work it shows, leaving the conversations alone", async () => {
    const { handle, posted, calls } = setUp({ apps: [lunch], stopped: ["lunch-split", "notes"] });

    await handle({ type: "start-stopped" });

    assert.deepEqual(calls, ["run again lunch-split", "run again notes"]);
    assert.deepEqual(posted.flatMap((m) => stateOf(m)?.working?.app ?? []), ["lunch-split", "notes"]);
  });

  it("starts each running app again once Mayfly updates, as work it shows, so each runs the way the new version runs apps", async () => {
    const { handle, posted, calls } = setUp({ apps: [lunch], running: ["lunch", "notes"] });

    await handle({ type: "updated" });

    assert.deepEqual(calls, ["run again lunch", "run again notes"]);
    assert.deepEqual(posted.flatMap((m) => stateOf(m)?.working?.app ?? []), ["lunch", "notes"]);
  });

  it("opens a new app only once an attempt at it passed", async () => {
    const { handle, opened, posted } = setUp({ apps: [], created: { ...lunch, head: null } });

    await handle({ type: "send", app: null, request: "split lunch bills" });

    assert.deepEqual(opened, []);
    assert.ok(posted.some((m) => m.type === "created"));
  });

  it("changes an app in its own conversation, without opening another browser tab", async () => {
    const { handle, opened, calls } = setUp({ apps: [lunch] });

    await handle({ type: "send", app: "lunch-split", request: "add a monthly total" });

    assert.deepEqual(calls, ["change lunch-split add a monthly total"]);
    assert.deepEqual(opened, []);
  });

  it("takes one request at a time", async () => {
    const { handle, posted, calls, finish } = setUp({ apps: [lunch], waitForCreate: true });

    const first = handle({ type: "send", app: null, request: "split lunch bills" });
    await handle({ type: "send", app: "lunch-split", request: "add a monthly total" });
    await handle({ type: "remove", name: "lunch-split" });
    finish();
    await first;

    assert.deepEqual(calls, ["create split lunch bills with openai"]);
    assert.equal(posted.filter((m) => m.type === "error").length, 2);
  });

  it("reports a failure in plain words and leaves the page usable", async () => {
    const { handle, posted } = setUp({ apps: [], createFails: "The app still failed after 3 attempts." });

    await handle({ type: "send", app: null, request: "split lunch bills" });

    assert.ok(posted.some((m) => m.type === "error" && m.text.includes("3 attempts")));
    assert.equal(stateOf(posted.at(-1))?.working, null);
  });

  it("takes the page to a new app whose work was kept though it didn't start, where its conversation says why", async () => {
    const { handle, posted } = setUp({ apps: [], createFails: new RecordedFailure("Stop the program using port 5556 and try again", "lunch-split") });

    await handle({ type: "send", app: null, request: "split lunch bills" });

    assert.ok(posted.some((m) => m.type === "created" && m.name === "lunch-split"));
    assert.ok(posted.some((m) => m.type === "error" && m.recorded === true));
  });

  it("tells the page when a failure is already in the app's conversation, so it is not said twice", async () => {
    const kept = setUp({ apps: [lunch], changeFails: new RecordedFailure("The model's service is down.", "lunch-split") });
    const lost = setUp({ apps: [lunch], changeFails: new Error("Podman is not running.") });

    await kept.handle({ type: "send", app: "lunch-split", request: "add totals" });
    await lost.handle({ type: "send", app: "lunch-split", request: "add totals" });

    assert.deepEqual(kept.posted.find((m) => m.type === "error"), { type: "error", text: "The model's service is down.", recorded: true });
    assert.deepEqual(lost.posted.find((m) => m.type === "error"), { type: "error", text: "Podman is not running." });
  });

  it("says whether the page had the focus when work ended, as the person may be in another window", async () => {
    const { handle, notes } = setUp({ apps: [lunch] });

    await handle({ type: "focus", on: false });
    await handle({ type: "send", app: "lunch-split", request: "add totals" });

    assert.equal(notes.at(-1)?.seen, false);
  });

  it("tells the person when work ends, and when it fails", async () => {
    const done = setUp({ apps: [lunch] });
    const failing = setUp({ apps: [], createFails: "The model's service is down." });

    await done.handle({ type: "send", app: "lunch-split", request: "add totals" });
    await failing.handle({ type: "send", app: null, request: "split lunch bills" });

    assert.deepEqual(done.notes, [{ text: "Changed lunch-split", failed: false, seen: true }]);
    assert.deepEqual(failing.notes, [{ text: "Could not finish “split lunch bills”: The model's service is down.", failed: true, seen: true }]);
  });

  it("refuses an empty request", async () => {
    const { handle, posted, calls } = setUp({ apps: [] });

    await handle({ type: "send", app: null, request: "   " });

    assert.equal(calls.length, 0);
    assert.equal(posted[0]?.type, "error");
  });

  it("opens an app by name, at the URL the engine knows rather than one from the page", async () => {
    const { handle, opened } = setUp({ apps: [lunch] });

    await handle({ type: "open", name: "lunch-split" });
    await handle({ type: "open", name: "not-an-app" });

    assert.deepEqual(opened, [lunch.url]);
  });

  it("sends the files attached to a request, and refuses ones Mayfly does not take", async () => {
    const { handle, posted, calls } = setUp({ apps: [lunch] });
    const csv = { name: "bills.csv", type: "text/csv", data: Buffer.from("who,amount").toString("base64") };

    await handle({ type: "send", app: "lunch-split", request: "use these bills", files: [csv] });
    await handle({ type: "send", app: "lunch-split", request: "read this", files: [{ name: "report.pdf", type: "application/pdf", data: "JVBERi0=" }] });

    assert.deepEqual(calls, ["change lunch-split use these bills with bills.csv (10 bytes)"]);
    const refusal = posted.at(-1);
    assert.ok(refusal?.type === "error" && /not report\.pdf/.test(refusal.text));
  });

  it("sends the page a file from an app's conversation, for it to show", async () => {
    const { handle, posted } = setUp({ apps: [lunch] });

    await handle({ type: "attachment", app: "lunch-split", id: "f1" });

    assert.deepEqual(posted.at(-1), { type: "attachment", app: "lunch-split", id: "f1", name: "mockup.png", mediaType: "image/png", data: "AQID" });
  });

  it("opens a link from a reply in the browser, but only to a web page", async () => {
    const { handle, opened, posted } = setUp({ apps: [] });

    await handle({ type: "open-link", url: "https://hono.dev/docs" });
    await handle({ type: "open-link", url: "file:///etc/passwd" });
    await handle({ type: "open-link", url: "javascript:alert(1)" });

    assert.deepEqual(opened, ["https://hono.dev/docs"]);
    assert.equal(posted.filter((m) => m.type === "error").length, 2);
  });

  it("removes an app, showing it is being removed until it is gone", async () => {
    const { handle, posted, calls } = setUp({ apps: [lunch] });

    await handle({ type: "remove", name: "lunch-split" });

    assert.deepEqual(calls, ["remove lunch-split"]);
    assert.partialDeepStrictEqual(stateOf(posted[0])?.working, { app: "lunch-split", kind: "remove" });
    assert.equal(stateOf(posted.at(-1))?.working, null);
  });

  it("copies the owner's email and password to the clipboard, without sending the password to the page", async () => {
    const { handle, posted, copied } = setUp({ apps: [] });

    await handle({ type: "copy", what: "email" });
    await handle({ type: "copy", what: "password" });
    await handle({ type: "copy", what: "username" });

    assert.deepEqual(copied, [owner.email, owner.password]);
    assert.ok(!JSON.stringify(posted).includes(owner.password));
  });

  it("sends the page the owner's password only when the person asks to see it", async () => {
    const { handle, posted } = setUp({ apps: [] });

    await handle({ type: "ready" });
    const before = JSON.stringify(posted);
    await handle({ type: "show-password" });

    assert.ok(!before.includes(owner.password));
    assert.deepEqual(posted.at(-1), { type: "password", password: owner.password });
  });

  it("keeps an API key in secret storage for the endpoint it was given for, and never sends it to the page", async () => {
    const { handle, posted, savedKeys } = setUp({ apps: [], keyFor: [] });

    await handle({ type: "save-model", model: openai, apiKey: "  sk-proj-abc  " });
    await handle({ type: "save-model", model: local, apiKey: "" });

    assert.deepEqual(savedKeys, [[OPENAI_ENDPOINT, "sk-proj-abc"]]);
    assert.ok(!JSON.stringify(posted).includes("sk-proj-abc"));
    assert.deepEqual(
      stateOf(posted.at(-1))?.models.map((model) => [model.label, model.hasApiKey]),
      [
        ["OpenAI · gpt-6.2-sol", true],
        ["localhost:11434 · qwen3", false],
      ],
    );
  });

  it("adds a model, makes it the default, and will not remove the default", async () => {
    const { handle, posted, models } = setUp({ apps: [] });

    await handle({ type: "save-model", model: local, apiKey: "" });
    const added = models().models[1]?.id ?? "";
    await handle({ type: "default-model", id: added });
    await handle({ type: "remove-model", id: added });
    await handle({ type: "remove-model", id: "openai" });

    assert.deepEqual(
      models().models.map((model) => model.id),
      [added],
    );
    assert.equal(models().default, added);
    assert.ok(posted.some((m) => m.type === "error" && m.text.includes("another model the default")));
  });

  it("writes a new app with the model picked for it, and switches an app to another model", async () => {
    const { handle, calls } = setUp({ apps: [lunch] });

    await handle({ type: "send", app: null, request: "keep notes", model: "openai" });
    await handle({ type: "use-model", app: "lunch-split", model: "openai" });
    await handle({ type: "use-model", app: "lunch-split", model: "gone" });

    assert.deepEqual(calls, ["create keep notes with openai", "use lunch-split openai"]);
  });

  it("refuses an OpenAI-compatible provider without a web URL, or a model without a name", async () => {
    const { handle, posted, models } = setUp({ apps: [] });

    await handle({ type: "save-model", model: { ...local, baseUrl: "file:///etc" }, apiKey: "" });
    await handle({ type: "save-model", model: { ...openai, model: " " }, apiKey: "" });

    assert.equal(models().models.length, 1);
    assert.deepEqual(
      posted.map((m) => m.type),
      ["error", "error"],
    );
  });

  it("adds someone and offers to email them, without sending their password to the page", async () => {
    const { handle, posted, opened } = setUp({ apps: [lunch] });

    await handle({ type: "add-person", email: "ana@example.com" });

    assert.deepEqual(stateOf(posted.at(-2))?.people, ["ana@example.com"]);
    assert.deepEqual(posted.at(-1), { type: "offer-email", about: "welcome", email: "ana@example.com" });
    assert.deepEqual(opened, []);
    assert.ok(!JSON.stringify(posted).includes("ana-six-word-pass"));
  });

  it("drafts the welcome email in the mail app when the owner says so, with the password", async () => {
    const { handle, opened } = setUp({ apps: [lunch] });
    await handle({ type: "add-person", email: "ana@example.com" });

    await handle({ type: "email", about: "welcome", email: "ana@example.com" });

    assert.match(opened[0] ?? "", /^mailto:ana@example\.com\?/);
    assert.match(decodeURIComponent(opened[0] ?? ""), /Password: ana-six-word-pass/);
  });

  it("shows someone's password only when asked", async () => {
    const { handle, posted } = setUp({ apps: [lunch] });
    await handle({ type: "add-person", email: "ana@example.com" });

    await handle({ type: "show-password", email: "ana@example.com" });

    assert.deepEqual(posted.at(-1), { type: "password", email: "ana@example.com", password: "ana-six-word-pass" });
  });

  it("shares an app, offers to email them, and drafts its address on the private network when the owner says so", async () => {
    const { handle, posted, opened, calls } = setUp({ apps: [lunch] });
    await handle({ type: "phone", on: true });
    await handle({ type: "add-person", email: "ana@example.com" });

    await handle({ type: "share", app: "lunch-split", email: "ana@example.com", shared: true });
    await handle({ type: "email", about: "shared", email: "ana@example.com", app: "lunch-split" });

    assert.ok(calls.includes("share lunch-split ana@example.com true"));
    assert.ok(posted.some((message) => message.type === "offer-email" && message.about === "shared"));
    assert.match(decodeURIComponent(opened.at(-1) ?? ""), /You can now open lunch-split, an app I made with Mayfly:\s+https:\/\/mayfly\.tail1a2b\.ts\.net:38100\//);
  });

  it("emails a shared app only to someone it's shared with", async () => {
    const { handle, posted, opened } = setUp({ apps: [lunch] });
    await handle({ type: "phone", on: true });

    await handle({ type: "email", about: "shared", email: "anyone@example.com", app: "lunch-split" });

    assert.deepEqual(opened, []);
    assert.ok(posted.some((message) => message.type === "error" && message.text === "`lunch-split` isn't shared with `anyone@example.com`"));
  });

  it("sets up the account Mayfly sends email from once it signs in to the server with it, and never shows the password again", async () => {
    const { handle, posted, mail } = setUp({ apps: [lunch] });

    await handle({ type: "save-mail", account: { host: " SMTP.example.com ", port: 465, username: " me@example.com ", from: "" }, password: "app password" });

    const account = { host: "smtp.example.com", port: 465, username: "me@example.com", password: "app password", from: "me@example.com" };
    assert.deepEqual(mail.verified, [account]);
    assert.deepEqual(mail.account(), account);
    assert.deepEqual(posted.at(-2), { type: "notice", text: "Mayfly sends email from `me@example.com` now" });
    assert.deepEqual(stateOf(posted.at(-1))?.mail, { host: "smtp.example.com", port: 465, username: "me@example.com", from: "me@example.com" });
    assert.ok(!JSON.stringify(posted).includes("app password"));
  });

  it("keeps an account only once the server lets Mayfly sign in, and says why it didn't", async () => {
    const { handle, posted, mail } = setUp({ apps: [lunch], signInFails: "Invalid login: 535 5.7.8 Authentication credentials invalid" });

    await handle({ type: "save-mail", account: { host: "smtp.example.com", port: 587, username: "me", from: "me@example.com" }, password: "wrong" });

    assert.equal(mail.account(), undefined);
    assert.deepEqual(posted.at(-1), { type: "error", text: "Mayfly couldn't sign in to `smtp.example.com`: Invalid login: 535 5.7.8 Authentication credentials invalid" });
  });

  it("refuses an account it can't use before trying the server", async () => {
    const { handle, posted, mail } = setUp({ apps: [lunch] });
    const fine = { host: "smtp.example.com", port: 465, username: "me@example.com", from: "" };

    await handle({ type: "save-mail", account: { ...fine, host: "smtp://smtp.example.com" }, password: "p" });
    await handle({ type: "save-mail", account: { ...fine, port: 0 }, password: "p" });
    await handle({ type: "save-mail", account: { ...fine, username: " " }, password: "p" });
    await handle({ type: "save-mail", account: { ...fine, from: "me" }, password: "p" });
    await handle({ type: "save-mail", account: fine, password: "" });

    assert.deepEqual(mail.verified, []);
    assert.deepEqual(
      posted.map((m) => m.type),
      ["error", "error", "error", "error", "error"],
    );
  });

  it("keeps the saved password for the same server and username, and never sends it to another", async () => {
    const { handle, posted, mail } = setUp({ apps: [lunch] });
    const account = { host: "smtp.example.com", port: 465, username: "me@example.com", from: "" };
    await handle({ type: "save-mail", account, password: "app password" });

    await handle({ type: "save-mail", account: { ...account, from: "me+apps@example.com" }, password: "" });
    await handle({ type: "save-mail", account: { ...account, host: "smtp.elsewhere.test" }, password: "" });

    assert.deepEqual(mail.account(), { ...account, password: "app password", from: "me+apps@example.com" });
    assert.deepEqual(mail.verified.map((tried) => tried.host), ["smtp.example.com", "smtp.example.com"]);
    assert.equal(posted.at(-1)?.type, "error");
  });

  it("sends the email itself from the owner's account, as HTML with a plain-text copy, once one is set up", async () => {
    const { handle, posted, opened, mail } = setUp({ apps: [lunch] });
    await handle({ type: "save-mail", account: { host: "smtp.example.com", port: 465, username: "me@example.com", from: "" }, password: "app password" });
    await handle({ type: "add-person", email: "ana@example.com" });

    await handle({ type: "email", about: "welcome", email: "ana@example.com" });

    assert.deepEqual(opened, []);
    const [message] = mail.sent;
    assert.partialDeepStrictEqual(message, { from: "me@example.com", to: "ana@example.com", subject: "Your sign-in for my Mayfly apps" });
    assert.match(message?.text ?? "", /Password: ana-six-word-pass/);
    assert.match(message?.html ?? "", />ana-six-word-pass</);
    assert.deepEqual(posted.at(-1), { type: "notice", text: "Sent to `ana@example.com`" });
  });

  it("says why an email didn't go", async () => {
    const { handle, posted, opened } = setUp({ apps: [lunch], sendFails: "Connection timeout" });
    await handle({ type: "save-mail", account: { host: "smtp.example.com", port: 465, username: "me@example.com", from: "" }, password: "app password" });
    await handle({ type: "add-person", email: "ana@example.com" });

    await handle({ type: "email", about: "welcome", email: "ana@example.com" });

    assert.deepEqual(opened, []);
    assert.deepEqual(posted.at(-2), { type: "error", text: "Couldn't send the email to `ana@example.com`: Connection timeout" });
  });

  it("forgets the account, and drafts emails in the mail app again", async () => {
    const { handle, posted, opened, mail } = setUp({ apps: [lunch] });
    await handle({ type: "save-mail", account: { host: "smtp.example.com", port: 465, username: "me@example.com", from: "" }, password: "app password" });
    await handle({ type: "add-person", email: "ana@example.com" });

    await handle({ type: "remove-mail" });
    await handle({ type: "email", about: "welcome", email: "ana@example.com" });

    assert.equal(mail.account(), undefined);
    assert.equal(stateOf(posted.findLast((m) => m.type === "state"))?.mail, null);
    assert.match(opened[0] ?? "", /^mailto:ana@example\.com\?/);
  });

  it("won't share an app while phone access is off, since no one else could reach it", async () => {
    const { handle, posted, calls } = setUp({ apps: [lunch] });
    await handle({ type: "add-person", email: "ana@example.com" });

    await handle({ type: "share", app: "lunch-split", email: "ana@example.com", shared: true });

    assert.ok(!calls.some((call) => call.startsWith("share")));
    const error = posted.find((message) => message.type === "error");
    assert.match(error?.type === "error" ? error.text : "", /Turn on phone access/);
  });

  it("ignores messages it does not understand", async () => {
    const { handle, posted } = setUp({ apps: [] });

    await handle({ type: "format-disk" });
    await handle({ type: "save-model", model: { id: "", provider: "elsewhere", baseUrl: "", model: "m" }, apiKey: "" });
    await handle("hello");
    await handle(null);

    assert.equal(posted.length, 0);
  });
});

function stateOf(message: ToUi | undefined) {
  return message?.type === "state" ? message : undefined;
}

interface Options {
  apps: AppView[];
  created?: AppView;
  steps?: Step[];
  developer?: boolean;
  keyFor?: string[];
  createFails?: string | Error;
  /** What a change fails with, if it does. */
  changeFails?: Error;
  waitForCreate?: boolean;
  /** The apps Podman is not running. */
  stopped?: string[];
  running?: string[];
  phones?: PhoneView[];
  /** Why turning phone access on fails, if it does. */
  phoneFails?: string;
  /** Why the mail server won't let Mayfly sign in, if it won't. */
  signInFails?: string;
  /** Why an email doesn't go, if it doesn't. */
  sendFails?: string;
}

function setUp({ apps, created: made = lunch, steps = [], developer: developing = false, keyFor = [OPENAI_ENDPOINT], createFails, changeFails, waitForCreate = false, stopped: stoppedApps = [], running: runningApps = [], phones: paired = [], phoneFails, signInFails, sendFails }: Options) {
  let phoneHost: string | null = null;
  let phoneCreation = false;
  let phones = [...paired];
  let account: MailAccount | undefined;
  const verified: MailAccount[] = [];
  const sent: Outgoing[] = [];
  const people = new Map<string, string>();
  const posted: ToUi[] = [];
  const notes: { text: string; failed: boolean; seen: boolean }[] = [];
  const opened: string[] = [];
  const copied: string[] = [];
  const calls: string[] = [];
  const savedKeys: [string, string][] = [];
  const keys = new Set(keyFor);
  let models: Models = { models: [openai], default: "openai" };
  let developer = developing;
  let autostart = false;
  let finish = (): void => {};
  const created = new Promise<void>((resolve) => (finish = resolve));
  const engine: Engine = {
    create: async (description, { model, watch = () => {} }: { model?: string | null; watch?: Watcher } = {}) => {
      calls.push(`create ${description} with ${model}`);
      steps.forEach((step) => watch(step));
      if (waitForCreate) await created;
      if (createFails !== undefined) throw typeof createFails === "string" ? new Error(createFails) : createFails;
      apps.push(made);
      return made;
    },
    written: async () => ({ routes: "export default 1;\n", thinking: "One route will do." }),
    attachment: async () => ({ name: "mockup.png", type: "image/png", data: new Uint8Array([1, 2, 3]) }),
    save: async (name, from, routes, message) => {
      calls.push(`save ${name} ${from} ${routes.trim()} ${message}`);
      const by = { kind: "person", name: "owner@mayfly.local" } as const;
      const mine = { id: "v2", parent: from, request: message, by, attempt: 1, summary: "", problem: null, spent: { input: 0, output: 0, thinking: 0 }, at: 1, lines: 1, thinkingWords: 0 };
      return { ...lunch, versions: [mine] };
    },
    deploy: async (name, version) => {
      calls.push(`deploy ${name} ${version}`);
      return lunch;
    },
    star: async (name, starred) => void calls.push(`star ${name} ${starred}`),
    useModel: async (name, model) => {
      calls.push(`use ${name} ${model}`);
      return lunch;
    },
    change: async (name, request, _watch, files = []) => {
      calls.push(`change ${name} ${request}${files.length === 0 ? "" : ` with ${files.map((file) => `${file.name} (${file.data.length} bytes)`).join(", ")}`}`);
      if (changeFails !== undefined) throw changeFails;
      return lunch;
    },
    rename: async (name, to) => {
      calls.push(`rename ${name} ${to}`);
      return { ...lunch, name: to };
    },
    fix: async (name) => {
      calls.push(`fix ${name}`);
      return lunch;
    },
    retry: async (name) => {
      calls.push(`retry ${name}`);
      return lunch;
    },
    undo: async (name) => {
      calls.push(`undo ${name}`);
      return lunch;
    },
    start: async (name) => {
      calls.push(`start ${name}`);
      return lunch;
    },
    runAgain: async (name) => {
      calls.push(`run again ${name}`);
      return lunch;
    },
    ask: async (name, question, watch = () => {}) => {
      calls.push(`ask ${name} ${question}`);
      steps.forEach((step) => watch(step));
      await new Promise((resolve) => setTimeout(resolve, ANSWER_MS));
      return lunch;
    },
    list: async () => [...apps],
    remove: async (name) => void calls.push(`remove ${name}`),
    owner: async () => owner,
    changeEmail: async (email) => (calls.push(`email ${email}`), { ...owner, email }),
    newPassword: async () => ({ ...owner, password: "brand-new-pass" }),
    spent: async () => ({ input: 500, output: 80, thinking: 0 }),
    ledger: async () => [call],
    logs: async (pod, container) => [`2026-11-26T15:04:05Z ${pod} ${container}`],
    health: async () => [{ name: "lunch-split", kind: "app", pod: "mayfly-lunch-split", containers: [] }],
    stopped: async () => stoppedApps,
    running: async () => runningApps,
    phoneAccess: async () => phoneHost,
    turnOnPhone: async () => {
      calls.push("turn on phone");
      if (phoneFails !== undefined) throw new Error(phoneFails);
      return (phoneHost = "mayfly.tail1a2b.ts.net");
    },
    turnOffPhone: async () => {
      calls.push("turn off phone");
      phoneHost = null;
    },
    offerPairing: async () => ({ code: "pairing-code", expires: 1234 }),
    pair: async () => "phone-token",
    pairedPhone: async () => null,
    phones: async () => phones,
    forgetPhone: async (id) => {
      calls.push(`forget phone ${id}`);
      phones = phones.filter((phone) => phone.id !== id);
    },
    people: async () => [...people.keys()],
    person: async (email) => ({ email, password: people.get(email) ?? "", group: "person-1" }),
    addPerson: async (email) => {
      people.set(email, `${email.split("@")[0]}-six-word-pass`);
      return { email, password: people.get(email) ?? "", group: "person-1" };
    },
    newPersonPassword: async (email) => ({ email, password: "brand-new-six-words", group: "person-2" }),
    removePerson: async (email) => void people.delete(email),
    share: async (name, email, shared) => {
      calls.push(`share ${name} ${email} ${shared}`);
      apps = apps.map((app) => (app.name === name ? { ...app, people: shared ? [...app.people, email] : app.people.filter((other) => other !== email) } : app));
      return { ...lunch, people: shared ? [email] : [] };
    },
  };
  const handle = createController({
    engine,
    post: async (message) => void posted.push(message),
    notify: (note) => void notes.push(note),
    openExternal: async (url) => void opened.push(url),
    copy: async (text) => void copied.push(text),
    doctor: async (tell) => {
      const examination: Examination = { ready: [{ name: "Podman", status: "pass", detail: "Podman 5.8.9 is running" }], models: [{ id: "openai", status: "pass", detail: "Ready" }] };
      tell(examination);
      return examination;
    },
    settings: {
      models: () => models,
      saveModels: async (next) => void (models = next),
      developer: () => developer,
      saveDeveloper: async (on) => void (developer = on),
      autostart: () => autostart,
      saveAutostart: async (on) => void (autostart = on),
      phoneCreation: () => phoneCreation,
      savePhoneCreation: async (on) => void (phoneCreation = on),
    },
    phonePage: {
      start: async () => void calls.push("serve the phone page"),
      stop: async () => void calls.push("stop the phone page"),
    },
    keys: {
      has: async (endpoint) => keys.has(endpoint),
      save: async (endpoint, key) => void (savedKeys.push([endpoint, key]), keys.add(endpoint)),
    },
    mail: {
      account: async () => account,
      save: async (next) => void (account = next),
      remove: async () => void (account = undefined),
      verify: async (tried) => {
        verified.push(tried);
        if (signInFails !== undefined) throw new Error(signInFails);
      },
      send: async (_from, message) => {
        if (sendFails !== undefined) throw new Error(sendFails);
        sent.push(message);
      },
    },
  });
  const mail = { account: () => account, verified, sent };
  return { handle, posted, opened, copied, calls, savedKeys, models: () => models, finish, notes, mail };
}
