import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AppView, Engine } from "../../engine/engine.ts";
import type { ModelCall } from "../../engine/state.ts";
import type { Step, Watcher } from "../../engine/step.ts";
import { createController } from "./controller.ts";
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
      models: [{ ...openai, label: "OpenAI · gpt-6.2-sol", hasApiKey: true }],
      defaultModel: "openai",
      spent: { input: 500, output: 80, thinking: 0 },
      working: null,
      developer: false,
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

  it("passes on the doctor's checks", async () => {
    const { handle, posted } = setUp({ apps: [] });

    await handle({ type: "doctor" });

    assert.deepEqual(posted, [{ type: "doctor", ready: [{ name: "Podman", status: "pass", detail: "Podman 5.8.9 is running." }], models: [{ id: "openai", status: "pass", detail: "The provider accepts the key and has this model." }] }]);
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

  it("removes an app, showing it is being removed until it is gone", async () => {
    const { handle, posted, calls } = setUp({ apps: [lunch] });

    await handle({ type: "remove", name: "lunch-split" });

    assert.deepEqual(calls, ["remove lunch-split"]);
    assert.partialDeepStrictEqual(stateOf(posted[0])?.working, { app: "lunch-split", kind: "remove" });
    assert.equal(stateOf(posted.at(-1))?.working, null);
  });

  it("copies the owner's email and password to the clipboard, never sending the password to the page", async () => {
    const { handle, posted, copied } = setUp({ apps: [] });

    await handle({ type: "copy", what: "email" });
    await handle({ type: "copy", what: "password" });
    await handle({ type: "copy", what: "username" });

    assert.deepEqual(copied, [owner.email, owner.password]);
    assert.ok(!JSON.stringify(posted).includes(owner.password));
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
  createFails?: string;
  waitForCreate?: boolean;
}

function setUp({ apps, created: made = lunch, steps = [], developer: developing = false, keyFor = [OPENAI_ENDPOINT], createFails, waitForCreate = false }: Options) {
  const posted: ToUi[] = [];
  const opened: string[] = [];
  const copied: string[] = [];
  const calls: string[] = [];
  const savedKeys: [string, string][] = [];
  const keys = new Set(keyFor);
  let models: Models = { models: [openai], default: "openai" };
  let developer = developing;
  let finish = (): void => {};
  const created = new Promise<void>((resolve) => (finish = resolve));
  const engine: Engine = {
    create: async (description, { model, watch = () => {} }: { model?: string | null; watch?: Watcher } = {}) => {
      calls.push(`create ${description} with ${model}`);
      steps.forEach((step) => watch(step));
      if (waitForCreate) await created;
      if (createFails) throw new Error(createFails);
      apps.push(made);
      return made;
    },
    written: async () => ({ routes: "export default 1;\n", thinking: "One route will do." }),
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
    change: async (name, request) => {
      calls.push(`change ${name} ${request}`);
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
  };
  const handle = createController({
    engine,
    post: async (message) => void posted.push(message),
    openExternal: async (url) => void opened.push(url),
    copy: async (text) => void copied.push(text),
    doctor: async () => ({ ready: [{ name: "Podman", status: "pass", detail: "Podman 5.8.9 is running." }], models: [{ id: "openai", status: "pass", detail: "The provider accepts the key and has this model." }] }),
    settings: {
      models: () => models,
      saveModels: async (next) => void (models = next),
      developer: () => developer,
      saveDeveloper: async (on) => void (developer = on),
    },
    keys: {
      has: async (endpoint) => keys.has(endpoint),
      save: async (endpoint, key) => void (savedKeys.push([endpoint, key]), keys.add(endpoint)),
    },
  });
  return { handle, posted, opened, copied, calls, savedKeys, models: () => models, finish };
}
