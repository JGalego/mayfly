import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parse, suggestions } from "./commands.ts";

const models = ["OpenAI · gpt-6.2-sol", "localhost:11434 · qwen3"];

describe("commands", () => {
  it("reads a request as a request, and a slash and a name as a command with what follows it", () => {
    assert.deepEqual(parse("split lunch bills"), { kind: "request", text: "split lunch bills" });
    assert.partialDeepStrictEqual(parse("/model  OpenAI · gpt-6.2-sol"), { kind: "command", command: { name: "model" }, argument: "OpenAI · gpt-6.2-sol" });
    assert.partialDeepStrictEqual(parse("/REMOVE"), { kind: "command", command: { name: "remove" }, argument: "" });
    assert.partialDeepStrictEqual(parse("/ask how does it\nsplit?"), { kind: "command", command: { name: "ask" }, argument: "how does it\nsplit?" });
    assert.deepEqual(parse("/deploy v1"), { kind: "unknown", name: "deploy" });
  });

  it("offers the commands that start with what is typed, only those that need no app when there is none", () => {
    assert.deepEqual(
      suggestions("/", { app: true, models }).map((s) => s.fill),
      ["/ask ", "/model ", "/remove "],
    );
    assert.deepEqual(
      suggestions("/", { app: false, models }).map((s) => s.label),
      ["/model"],
    );
    assert.deepEqual(suggestions("split", { app: true, models }), []);
    assert.deepEqual(suggestions("/remove now", { app: true, models }), []);
  });

  it("completes /model with the models whose provider or name holds what is typed", () => {
    assert.deepEqual(
      suggestions("/model ", { app: true, models }).map((s) => s.fill),
      ["/model OpenAI · gpt-6.2-sol", "/model localhost:11434 · qwen3"],
    );
    assert.deepEqual(
      suggestions("/model QWEN", { app: true, models }).map((s) => s.label),
      ["localhost:11434 · qwen3"],
    );
    assert.deepEqual(suggestions("/model OpenAI · gpt-6.2-sol", { app: true, models }), [], "nothing left to complete");
  });
});
