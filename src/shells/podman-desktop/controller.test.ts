import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DeployedApp, Engine } from "../../engine/engine.ts";
import { createController } from "./controller.ts";
import type { ToUi } from "./messages.ts";

const lunch: DeployedApp = { name: "lunch-split", url: "http://localhost:18100/" };
const owner = { email: "owner@mayfly.local", username: "owner", password: "s3cret-pass" };

describe("the Mayfly panel's controller", () => {
  it("shows the apps, who signs in, and whether a key is set when the page loads", async () => {
    const { handle, posted } = setUp({ apps: [lunch] });

    await handle({ type: "ready" });

    assert.deepEqual(posted.at(-1), { type: "state", apps: [lunch], owner: owner.email, hasApiKey: true, model: "gpt-6.2-sol" });
  });

  it("makes an app from a description, then shows it and opens it", async () => {
    const { handle, posted, opened, created } = setUp({ apps: [] });

    await handle({ type: "create", description: "split lunch bills" });

    assert.deepEqual(created, ["split lunch bills"]);
    assert.equal(posted[0]?.type, "busy");
    assert.deepEqual(opened, [lunch.url]);
    assert.equal(posted.at(-1)?.type, "state");
  });

  it("reports a failure in plain words and leaves the page usable", async () => {
    const { handle, posted } = setUp({ apps: [], createFails: "The app still failed after 3 attempts." });

    await handle({ type: "create", description: "split lunch bills" });

    assert.ok(posted.some((m) => m.type === "error" && m.text.includes("3 attempts")));
    assert.equal(posted.at(-1)?.type, "state");
  });

  it("refuses an empty description", async () => {
    const { handle, posted, created } = setUp({ apps: [] });

    await handle({ type: "create", description: "   " });

    assert.equal(created.length, 0);
    assert.equal(posted[0]?.type, "error");
  });

  it("opens an app by name, at the URL the engine knows rather than one from the page", async () => {
    const { handle, opened } = setUp({ apps: [lunch] });

    await handle({ type: "open", name: "lunch-split" });
    await handle({ type: "open", name: "not-an-app" });

    assert.deepEqual(opened, [lunch.url]);
  });

  it("removes an app and shows what is left", async () => {
    const { handle, posted, removed } = setUp({ apps: [lunch] });

    await handle({ type: "remove", name: "lunch-split" });

    assert.deepEqual(removed, ["lunch-split"]);
    assert.equal(posted.at(-1)?.type, "state");
  });

  it("copies the owner's password to the clipboard without ever sending it to the page", async () => {
    const { handle, posted, copied } = setUp({ apps: [] });

    await handle({ type: "copy-password" });

    assert.deepEqual(copied, [owner.password]);
    assert.ok(!JSON.stringify(posted).includes(owner.password));
  });

  it("keeps the API key in secret storage and never sends it to the page", async () => {
    const { handle, posted, savedKeys } = setUp({ apps: [], hasKey: false });

    await handle({ type: "save-api-key", apiKey: "  sk-proj-abc  " });

    assert.deepEqual(savedKeys, ["sk-proj-abc"]);
    assert.ok(!JSON.stringify(posted).includes("sk-proj-abc"));
    assert.deepEqual(posted.at(-1), { type: "state", apps: [], owner: owner.email, hasApiKey: true, model: "gpt-6.2-sol" });
  });

  it("ignores messages it does not understand", async () => {
    const { handle, posted } = setUp({ apps: [] });

    await handle({ type: "format-disk" });
    await handle("hello");
    await handle(null);

    assert.equal(posted.length, 0);
  });
});

function setUp({ apps, hasKey = true, createFails }: { apps: DeployedApp[]; hasKey?: boolean; createFails?: string }) {
  const posted: ToUi[] = [];
  const opened: string[] = [];
  const copied: string[] = [];
  const created: string[] = [];
  const removed: string[] = [];
  const savedKeys: string[] = [];
  let keySet = hasKey;
  const engine: Engine = {
    create: async (description) => {
      created.push(description);
      if (createFails) throw new Error(createFails);
      apps.push(lunch);
      return lunch;
    },
    deploy: async () => lunch,
    list: async () => [...apps],
    remove: async (name) => void removed.push(name),
    owner: async () => owner,
  };
  const handle = createController({
    engine,
    post: async (message) => void posted.push(message),
    openExternal: async (url) => void opened.push(url),
    copy: async (text) => void copied.push(text),
    apiKey: {
      isSet: async () => keySet,
      save: async (key) => void (savedKeys.push(key), (keySet = true)),
    },
    modelName: () => "gpt-6.2-sol",
  });
  return { handle, posted, opened, copied, created, removed, savedKeys };
}
