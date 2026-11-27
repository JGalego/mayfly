import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { modelViews, readModel, saveModel, type ModelPorts } from "./model-settings.ts";
import { FIRST_MODELS, type Models, type ModelSetting } from "./settings.ts";

const GROQ: ModelSetting = { id: "groq", provider: "openai-compatible", baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b" };

function ports(models: Models = { ...FIRST_MODELS, models: [...FIRST_MODELS.models, GROQ] }): ModelPorts & { saved(): Models } {
  let current = models;
  return {
    settings: { models: () => current, saveModels: async (next) => void (current = next) },
    keys: { has: async () => true, save: async () => {} },
    saved: () => current,
  };
}

describe("a model's name", () => {
  it("is what the page calls the model, and without one the page calls it by its provider and model", async () => {
    const store = ports();

    assert.equal(await saveModel({ ...GROQ, name: "  Groq  " }, "", store), undefined);

    assert.deepEqual((await modelViews(store)).map((model) => model.label), ["OpenAI · gpt-6.2-sol", "Groq"]);
  });

  it("goes when it's cleared, so the model is called by its provider and model again", async () => {
    const store = ports({ ...FIRST_MODELS, models: [...FIRST_MODELS.models, { ...GROQ, name: "Groq" }] });

    await saveModel({ ...GROQ, name: " " }, "", store);

    assert.deepEqual(store.saved().models.find((model) => model.id === "groq"), GROQ);
  });

  it("can't be another model's, whatever its case, so /model always finds the one meant", async () => {
    const store = ports();

    assert.equal(await saveModel({ ...GROQ, name: "openai · GPT-6.2-sol" }, "", store), "Another model is called `OpenAI · gpt-6.2-sol`. Give this one another name.");
    assert.deepEqual(store.saved().models.find((model) => model.id === "groq"), GROQ);
  });

  it("can be the model's own, when the model keeps it", async () => {
    const store = ports({ ...FIRST_MODELS, models: [...FIRST_MODELS.models, { ...GROQ, name: "Groq" }] });

    assert.equal(await saveModel({ ...GROQ, name: "Groq", model: "llama-4" }, "", store), undefined);
  });

  it("is short", async () => {
    assert.equal(await saveModel({ ...GROQ, name: "x".repeat(41) }, "", ports()), "Keep the name under 40 characters.");
  });

  it("comes from the page as text, or not at all", () => {
    assert.deepEqual(readModel({ ...GROQ, name: "Groq" }), { ...GROQ, name: "Groq" });
    assert.deepEqual(readModel(GROQ), GROQ);
    assert.equal(readModel({ ...GROQ, name: 7 }), undefined);
  });
});
