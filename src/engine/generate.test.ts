import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateApp, type Ask } from "./generate.ts";
import type { Builder, Message, ModelProvider, Trial } from "./ports.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";
import type { Step } from "./step.ts";

const good = 'name: notes\n```ts\nexport default 1;\n```\nKeeps your notes.';
const broken = 'name: notes\n```ts\nthrow new Error("boom");\n```';
const newNotes: Ask = { description: "keep notes", taken: [] };

describe("generateApp", () => {
  it("builds and trials the app the model wrote, and returns it with what the model said", async () => {
    const { model, builder, built } = fakes([good], [{ ok: true }]);

    const generated = await generateApp(newNotes, { model, builder });

    assert.deepEqual(generated, { name: "notes", image: "image-1", routes: "export default 1;\n", summary: "Keeps your notes." });
    assert.deepEqual(built, [{ name: "notes", routes: "export default 1;\n" }]);
  });

  it("asks in the person's words, under the system prompt's rules", async () => {
    const { model, builder, conversations } = fakes([good], [{ ok: true }]);

    await generateApp(newNotes, { model, builder });

    assert.equal(conversations[0]?.system, SYSTEM_PROMPT);
    assert.match(conversations[0]?.messages[0]?.content ?? "", /keep notes/);
  });

  it("names a new app so it never replaces one that exists", async () => {
    const { model, builder } = fakes([good], [{ ok: true }]);

    const generated = await generateApp({ description: "keep notes", taken: ["notes", "notes-2"] }, { model, builder });

    assert.equal(generated.name, "notes-3");
  });

  it("changes an app from its current code, keeping its name whatever the model calls it", async () => {
    const { model, builder, conversations } = fakes([good], [{ ok: true }]);
    const app = { name: "my-notes", routes: "export default 0;\n" };

    const generated = await generateApp({ change: "add a search box", app }, { model, builder });

    const request = conversations[0]?.messages[0]?.content ?? "";
    assert.match(request, /export default 0;/);
    assert.match(request, /add a search box/);
    assert.equal(generated.name, "my-notes");
  });

  it("sends a failed trial's problem back to the model and tries again", async () => {
    const { model, builder, conversations } = fakes([broken, good], [{ ok: false, problem: "boom at start" }, { ok: true }]);

    const generated = await generateApp(newNotes, { model, builder });

    assert.equal(generated.image, "image-2");
    const repair = conversations[1]?.messages;
    assert.equal(repair?.[1]?.content, broken);
    assert.match(repair?.[2]?.content ?? "", /boom at start/);
  });

  it("tells the model when its reply is not in the expected format", async () => {
    const { model, builder, conversations, built } = fakes(["Sure! Here is an app.", good], [{ ok: true }]);

    await generateApp(newNotes, { model, builder });

    assert.equal(built.length, 1);
    assert.match(conversations[1]?.messages[2]?.content ?? "", /name/);
  });

  it("tells a watcher each step: writing, the code, building, trying it, and why it failed", async () => {
    const { model, builder } = fakes([broken, good], [{ ok: false, problem: "boom at start" }, { ok: true }]);
    const steps: Step[] = [];

    await generateApp(newNotes, { model, builder, watch: (step) => steps.push(step) });

    assert.deepEqual(steps, [
      { kind: "writing", attempt: 1 },
      { kind: "wrote", routes: 'throw new Error("boom");\n' },
      { kind: "building" },
      { kind: "trying" },
      { kind: "failed", problem: "boom at start" },
      { kind: "writing", attempt: 2 },
      { kind: "wrote", routes: "export default 1;\n" },
      { kind: "building" },
      { kind: "trying" },
    ]);
  });

  it("shows a watcher the model's reply as it arrives", async () => {
    const model: ModelProvider = {
      complete: async (_system, _messages, onText) => {
        for (const piece of ["name: notes\n", "```ts\nexport default 1;\n```"]) onText?.(piece);
        return { text: good, usage: { input: 1, output: 1 } };
      },
    };
    const { builder } = fakes([], [{ ok: true }]);
    const drafts: string[] = [];

    await generateApp(newNotes, { model, builder, watch: (step) => step.kind === "draft" && drafts.push(step.text) });

    assert.deepEqual(drafts, ["name: notes\n", "name: notes\n```ts\nexport default 1;\n```"]);
  });

  it("gives up after three attempts, saying what went wrong last", async () => {
    const trials: Trial[] = [1, 2, 3].map((n) => ({ ok: false, problem: `failure ${n}` }));
    const { model, builder } = fakes([broken, broken, broken], trials);

    await assert.rejects(generateApp(newNotes, { model, builder }), /3 attempts.*failure 3/s);
  });
});

function fakes(replies: string[], trials: Trial[]) {
  const conversations: { system: string; messages: Message[] }[] = [];
  const built: { name: string; routes: string }[] = [];
  const model: ModelProvider = {
    complete: async (system, messages) => {
      conversations.push({ system, messages: [...messages] });
      return { text: replies.shift() ?? "", usage: { input: 10, output: 5 } };
    },
  };
  const builder: Builder = {
    build: async (name, routes) => {
      built.push({ name, routes });
      return `image-${built.length}`;
    },
    trial: async () => trials.shift() ?? { ok: false, problem: "no more trials" },
  };
  return { model, builder, conversations, built };
}
