import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AppView, Engine } from "../../engine/engine.ts";
import { createController } from "./controller.ts";
import type { ToUi } from "./messages.ts";
import type { ModelChoice } from "./settings.ts";

const lunch: AppView = {
  name: "lunch-split",
  url: "http://localhost:18100/",
  conversation: [{ from: "person", text: "split lunch bills" }],
  spent: { input: 100, output: 20 },
};
const owner = { email: "owner@mayfly.local", username: "owner", password: "s3cret-pass" };
const openai: ModelChoice = { provider: "openai", baseUrl: "", model: "gpt-6.2-sol" };
const OPENAI_ENDPOINT = "https://api.openai.com/v1";

describe("the Mayfly panel's controller", () => {
  it("shows the apps, who signs in, the model, whether it has a key, and the tokens spent", async () => {
    const { handle, posted } = setUp({ apps: [lunch] });

    await handle({ type: "ready" });

    assert.deepEqual(posted.at(-1), {
      type: "state",
      apps: [lunch],
      owner: owner.email,
      model: openai,
      hasApiKey: true,
      spent: { input: 500, output: 80 },
      working: null,
    });
  });

  it("makes a new app, showing the work while it runs, then shows the app and opens it", async () => {
    const { handle, posted, opened, calls } = setUp({ apps: [] });

    await handle({ type: "send", app: null, request: " split lunch bills " });

    assert.deepEqual(calls, ["create split lunch bills"]);
    assert.deepEqual(stateOf(posted[0])?.working, { app: null, request: "split lunch bills" });
    assert.equal(stateOf(posted[1])?.working, null);
    assert.deepEqual(posted[2], { type: "created", name: "lunch-split" });
    assert.deepEqual(opened, [lunch.url]);
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

    assert.deepEqual(calls, ["create split lunch bills"]);
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

  it("removes an app and shows what is left", async () => {
    const { handle, posted, calls } = setUp({ apps: [lunch] });

    await handle({ type: "remove", name: "lunch-split" });

    assert.deepEqual(calls, ["remove lunch-split"]);
    assert.equal(posted.at(-1)?.type, "state");
  });

  it("copies the owner's password to the clipboard without ever sending it to the page", async () => {
    const { handle, posted, copied } = setUp({ apps: [] });

    await handle({ type: "copy-password" });

    assert.deepEqual(copied, [owner.password]);
    assert.ok(!JSON.stringify(posted).includes(owner.password));
  });

  it("keeps an API key in secret storage for the endpoint it was given for, and never sends it to the page", async () => {
    const { handle, posted, savedKeys } = setUp({ apps: [], keyFor: [] });
    const local: ModelChoice = { provider: "openai-compatible", baseUrl: "http://localhost:11434/v1", model: "qwen3" };

    await handle({ type: "save-settings", choice: openai, apiKey: "  sk-proj-abc  " });
    await handle({ type: "save-settings", choice: local, apiKey: "" });

    assert.deepEqual(savedKeys, [[OPENAI_ENDPOINT, "sk-proj-abc"]]);
    assert.ok(!JSON.stringify(posted).includes("sk-proj-abc"));
    assert.equal(stateOf(posted.at(-1))?.hasApiKey, false);
  });

  it("refuses an OpenAI-compatible provider without a web URL, or a model without a name", async () => {
    const { handle, posted, savedChoices } = setUp({ apps: [] });

    await handle({ type: "save-settings", choice: { provider: "openai-compatible", baseUrl: "file:///etc", model: "m" }, apiKey: "" });
    await handle({ type: "save-settings", choice: { ...openai, model: " " }, apiKey: "" });

    assert.deepEqual(savedChoices, []);
    assert.deepEqual(
      posted.map((m) => m.type),
      ["error", "error"],
    );
  });

  it("ignores messages it does not understand", async () => {
    const { handle, posted } = setUp({ apps: [] });

    await handle({ type: "format-disk" });
    await handle({ type: "save-settings", choice: { provider: "elsewhere", baseUrl: "", model: "m" }, apiKey: "" });
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
  keyFor?: string[];
  createFails?: string;
  waitForCreate?: boolean;
}

function setUp({ apps, keyFor = [OPENAI_ENDPOINT], createFails, waitForCreate = false }: Options) {
  const posted: ToUi[] = [];
  const opened: string[] = [];
  const copied: string[] = [];
  const calls: string[] = [];
  const savedKeys: [string, string][] = [];
  const savedChoices: ModelChoice[] = [];
  const keys = new Set(keyFor);
  let choice = openai;
  let finish = (): void => {};
  const created = new Promise<void>((resolve) => (finish = resolve));
  const engine: Engine = {
    create: async (description) => {
      calls.push(`create ${description}`);
      if (waitForCreate) await created;
      if (createFails) throw new Error(createFails);
      apps.push(lunch);
      return lunch;
    },
    change: async (name, request) => {
      calls.push(`change ${name} ${request}`);
      return lunch;
    },
    list: async () => [...apps],
    remove: async (name) => void calls.push(`remove ${name}`),
    owner: async () => owner,
    spent: async () => ({ input: 500, output: 80 }),
  };
  const handle = createController({
    engine,
    post: async (message) => void posted.push(message),
    openExternal: async (url) => void opened.push(url),
    copy: async (text) => void copied.push(text),
    settings: {
      read: () => choice,
      save: async (next) => void (savedChoices.push(next), (choice = next)),
    },
    keys: {
      has: async (endpoint) => keys.has(endpoint),
      save: async (endpoint, key) => void (savedKeys.push([endpoint, key]), keys.add(endpoint)),
    },
  });
  return { handle, posted, opened, copied, calls, savedKeys, savedChoices, finish };
}
