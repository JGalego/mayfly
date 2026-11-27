import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateApp, type Ask } from "./generate.ts";
import type { Builder, Message, ModelProvider, Trial } from "./ports.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";
import type { Step } from "./step.ts";

const good = 'name: notes\n```ts\nexport default 1;\n```\nKeeps your notes.';
const broken = 'name: notes\n```ts\nthrow new Error("boom");\n```';
const newNotes: Ask = { description: "keep notes", taken: [] };
const passed: Trial = { ok: true, keepsData: false };

describe("generateApp", () => {
  it("builds and trials the app the model wrote, and returns it with what the model said and spent", async () => {
    const { model, builder, built } = fakes([good], [passed]);

    const { name, attempts } = await generateApp(newNotes, { model, builder });

    assert.equal(name, "notes");
    assert.partialDeepStrictEqual(attempts, [{ routes: "export default 1;\n", summary: "Keeps your notes.", problem: null, image: "image-1", spent: { input: 10, output: 5, thinking: 0 } }]);
    assert.deepEqual(built, [{ name: "notes", routes: "export default 1;\n" }]);
  });

  it("asks in the person's words, under the system prompt's rules", async () => {
    const { model, builder, conversations } = fakes([good], [passed]);

    await generateApp(newNotes, { model, builder });

    assert.equal(conversations[0]?.system, SYSTEM_PROMPT);
    assert.match(String(conversations[0]?.messages[0]?.content ?? ""), /keep notes/);
  });

  it("names a new app so it never replaces one that exists", async () => {
    const { model, builder } = fakes([good], [passed]);

    const generated = await generateApp({ description: "keep notes", taken: ["notes", "notes-2"] }, { model, builder });

    assert.equal(generated.name, "notes-3");
  });

  it("never names a new app as Mayfly's sign-in is named", async () => {
    const { model, builder } = fakes([good.replace("name: notes", "name: dex")], [passed]);

    const generated = await generateApp(newNotes, { model, builder });

    assert.equal(generated.name, "dex-2");
  });

  it("changes an app from its current code, keeping its name whatever the model calls it", async () => {
    const { model, builder, conversations } = fakes([good], [passed]);
    const app = { name: "my-notes", routes: "export default 0;\n", keepsData: false };

    const generated = await generateApp({ change: "add a search box", app }, { model, builder });

    const request = String(conversations[0]?.messages[0]?.content ?? "");
    assert.match(request, /export default 0;/);
    assert.match(request, /add a search box/);
    assert.equal(generated.name, "my-notes");
  });

  it("tries a change on a copy of the records its app keeps, and a new app or one that keeps none on none", async () => {
    const { model, builder, triedOn } = fakes([good, good, good], [passed, passed, passed]);

    await generateApp({ change: "add tags", app: { name: "notes", routes: "export default 0;\n", keepsData: true } }, { model, builder });
    await generateApp({ change: "add tags", app: { name: "lunch", routes: "export default 0;\n", keepsData: false } }, { model, builder });
    await generateApp(newNotes, { model, builder });

    assert.deepEqual(triedOn, ["notes", null, null]);
  });

  it("notes which version keeps data, as its trial found", async () => {
    const { model, builder } = fakes([good], [{ ok: true, keepsData: true }]);

    const { attempts } = await generateApp(newNotes, { model, builder });

    assert.equal(attempts[0]?.problem === null && attempts[0].keepsData, true);
  });

  it("applies the model's edits to the app's code", async () => {
    const edits = "name: notes\n<<<<<<< SEARCH\nconst a = 1;\n=======\nconst a = 2;\n>>>>>>> REPLACE\nNow two.";
    const { model, builder, built } = fakes([edits], [passed]);
    const app = { name: "notes", routes: "const a = 1;\nexport default a;\n", keepsData: false };

    const { attempts } = await generateApp({ change: "make it two", app }, { model, builder });

    assert.deepEqual(built, [{ name: "notes", routes: "const a = 2;\nexport default a;\n" }]);
    assert.equal(attempts[0]?.summary, "Now two.");
  });

  it("tells the model when an edit matches nothing, showing it the code", async () => {
    const edits = "name: notes\n<<<<<<< SEARCH\nconst z = 9;\n=======\nconst z = 0;\n>>>>>>> REPLACE";
    const { model, builder, conversations } = fakes([edits, good], [passed]);
    const app = { name: "notes", routes: "const a = 1;\n", keepsData: false };

    await generateApp({ change: "make it zero", app }, { model, builder });

    const repair = String(conversations[1]?.messages[2]?.content ?? "");
    assert.match(repair, /edit 1 are not in routes\.ts/);
    assert.match(repair, /const a = 1;/);
  });

  it("sends a failed trial's problem back to the model and tries again", async () => {
    const { model, builder, conversations } = fakes([broken, good], [{ ok: false, problem: "boom at start" }, passed]);

    const { attempts } = await generateApp(newNotes, { model, builder });

    assert.deepEqual(
      attempts.map((attempt) => [attempt.problem, attempt.image]),
      [
        ["boom at start", null],
        [null, "image-2"],
      ],
    );
    const repair = conversations[1]?.messages;
    assert.equal(repair?.[1]?.content, broken);
    assert.match(String(repair?.[2]?.content ?? ""), /boom at start/);
  });

  it("tells the model when its reply is not in the expected format", async () => {
    const { model, builder, conversations, built } = fakes(["Sure! Here is an app.", good], [passed]);

    await generateApp(newNotes, { model, builder });

    assert.equal(built.length, 1);
    assert.match(String(conversations[1]?.messages[2]?.content ?? ""), /name/);
  });

  it("tells a watcher each step: writing, the code, building, trying it, and why it failed", async () => {
    const { model, builder } = fakes([broken, good], [{ ok: false, problem: "boom at start" }, passed]);
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

  it("shows a watcher the model's thinking and reply as they arrive, and keeps the thinking with the attempt", async () => {
    const model: ModelProvider = {
      name: "the test model",
      provider: "the test provider",
      complete: async (_system, _messages, listener) => {
        for (const piece of ["Notes need ", "one route."]) listener?.thinking?.(piece);
        for (const piece of ["name: notes\n", "```ts\nexport default 1;\n```"]) listener?.text?.(piece);
        return { text: good, thinking: "Notes need one route.", usage: { input: 1, output: 1, thinking: 0 } };
      },
    };
    const { builder } = fakes([], [passed]);
    const seen: string[] = [];

    const { attempts } = await generateApp(newNotes, { model, builder, watch: (step) => "text" in step && seen.push(`${step.kind}: ${step.text}`) });

    assert.deepEqual(seen, [
      "thinking: Notes need ",
      "thinking: Notes need one route.",
      "draft: name: notes\n",
      "draft: name: notes\n```ts\nexport default 1;\n```",
    ]);
    assert.equal(attempts[0]?.thinking, "Notes need one route.");
  });

  it("stops after three attempts, keeping each one and why it failed", async () => {
    const trials: Trial[] = [1, 2, 3].map((n) => ({ ok: false, problem: `failure ${n}` }));
    const { model, builder } = fakes([broken, broken, broken], trials);

    const { attempts } = await generateApp(newNotes, { model, builder });

    assert.deepEqual(
      attempts.map((attempt) => attempt.problem),
      ["failure 1", "failure 2", "failure 3"],
    );
  });

  it("keeps an attempt with no usable code, and names an app the model never named", async () => {
    const { model, builder } = fakes(["Sorry.", "No.", "Still no."], []);

    const { name, attempts } = await generateApp(newNotes, { model, builder });

    assert.equal(name, "new-app");
    assert.deepEqual(
      attempts.map((attempt) => attempt.routes),
      ["", "", ""],
    );
  });
});

function fakes(replies: string[], trials: Trial[]) {
  const conversations: { system: string; messages: Message[] }[] = [];
  const built: { name: string; routes: string }[] = [];
  /** Whose records each trial ran on, or null for none. */
  const triedOn: (string | null)[] = [];
  const model: ModelProvider = {
    name: "the test model",
    provider: "the test provider",
    complete: async (system, messages) => {
      conversations.push({ system, messages: [...messages] });
      return { text: replies.shift() ?? "", thinking: "", usage: { input: 10, output: 5, thinking: 0 } };
    },
  };
  const builder: Builder = {
    build: async (name, routes) => {
      built.push({ name, routes });
      return `image-${built.length}`;
    },
    trial: async (_image, data) => (triedOn.push(data), trials.shift() ?? { ok: false, problem: "no more trials" }),
    forget: async () => {},
  };
  return { model, builder, conversations, built, triedOn };
}
