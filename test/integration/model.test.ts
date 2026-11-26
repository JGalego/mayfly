import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { modelSettingsFromEnv, openAiCompatibleModel } from "../../src/adapters/openai-compatible/openai-compatible-model.ts";

// Calls a real, paid model, so it runs only when asked: MAYFLY_LIVE=1 with the settings from .env.example.
describe("the OpenAI-compatible model", { skip: process.env.MAYFLY_LIVE !== "1" && "set MAYFLY_LIVE=1 to call the model" }, () => {
  it("answers a conversation under a system prompt", async () => {
    const model = openAiCompatibleModel(modelSettingsFromEnv());

    const reply = await model.complete("Reply with one word, in lowercase.", [{ role: "user", content: "Say ok." }]);

    assert.match(reply, /ok/);
  });
});
