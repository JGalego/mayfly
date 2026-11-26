import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateApp } from "./generate.ts";
import type { Builder, Message, ModelProvider, Trial } from "./ports.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";

const good = 'name: notes\n```ts\nexport default 1;\n```';
const broken = 'name: notes\n```ts\nthrow new Error("boom");\n```';

describe("generateApp", () => {
  it("builds and trials the app the model wrote, and returns its manifest", async () => {
    const { model, builder, built } = fakes([good], [{ ok: true }]);

    const manifest = await generateApp("keep notes", { model, builder });

    assert.deepEqual(manifest, { name: "notes", image: "image-1" });
    assert.deepEqual(built, [{ name: "notes", routes: "export default 1;\n" }]);
  });

  it("asks in the person's words, under the system prompt's rules", async () => {
    const { model, builder, conversations } = fakes([good], [{ ok: true }]);

    await generateApp("keep notes", { model, builder });

    assert.equal(conversations[0]?.system, SYSTEM_PROMPT);
    assert.match(conversations[0]?.messages[0]?.content ?? "", /keep notes/);
  });

  it("sends a failed trial's problem back to the model and tries again", async () => {
    const { model, builder, conversations } = fakes([broken, good], [{ ok: false, problem: "boom at start" }, { ok: true }]);

    const manifest = await generateApp("keep notes", { model, builder });

    assert.equal(manifest.image, "image-2");
    const repair = conversations[1]?.messages;
    assert.equal(repair?.[1]?.content, broken);
    assert.match(repair?.[2]?.content ?? "", /boom at start/);
  });

  it("tells the model when its reply is not in the expected format", async () => {
    const { model, builder, conversations, built } = fakes(["Sure! Here is an app.", good], [{ ok: true }]);

    await generateApp("keep notes", { model, builder });

    assert.equal(built.length, 1);
    assert.match(conversations[1]?.messages[2]?.content ?? "", /name/);
  });

  it("gives up after three attempts, saying what went wrong last", async () => {
    const trials: Trial[] = [1, 2, 3].map((n) => ({ ok: false, problem: `failure ${n}` }));
    const { model, builder } = fakes([broken, broken, broken], trials);

    await assert.rejects(generateApp("keep notes", { model, builder }), /3 attempts.*failure 3/s);
  });
});

function fakes(replies: string[], trials: Trial[]) {
  const conversations: { system: string; messages: Message[] }[] = [];
  const built: { name: string; routes: string }[] = [];
  const model: ModelProvider = {
    complete: async (system, messages) => {
      conversations.push({ system, messages: [...messages] });
      return replies.shift() ?? "";
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
