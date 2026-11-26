import { randomUUID } from "node:crypto";
import type { ModelView } from "./messages.ts";
import { endpointOf, isProvider, labelOf, type Models, type ModelSetting } from "./settings.ts";

const MAX_MODEL_NAME = 200;

/** Where the models are kept, and the API keys, each for the endpoint it was given for. */
export interface ModelPorts {
  readonly settings: { models(): Models; saveModels(models: Models): Promise<void> };
  readonly keys: { has(endpoint: string): Promise<boolean>; save(endpoint: string, key: string): Promise<void> };
}

/** Adds a model, or changes one, and keeps its key if one came with it. Returns what is wrong with it, if anything. */
export async function saveModel(setting: ModelSetting, apiKey: string, { settings, keys }: ModelPorts): Promise<string | undefined> {
  const cleaned = { ...setting, baseUrl: setting.baseUrl.trim(), model: setting.model.trim() };
  const problem = problemWith(cleaned);
  if (problem !== undefined) return problem;
  const current = settings.models();
  const saved = { ...cleaned, id: cleaned.id === "" ? randomUUID() : cleaned.id };
  const exists = current.models.some((model) => model.id === saved.id);
  const models = exists ? current.models.map((model) => (model.id === saved.id ? saved : model)) : [...current.models, saved];
  await settings.saveModels({ ...current, models });
  if (apiKey !== "") await keys.save(endpointOf(saved), apiKey);
  return undefined;
}

/** Forgets a model. Apps it wrote carry on with the default one. */
export async function removeModel(id: string, { settings }: ModelPorts): Promise<string | undefined> {
  const current = settings.models();
  if (id === current.default) return "Make another model the default before removing this one.";
  await settings.saveModels({ ...current, models: current.models.filter((model) => model.id !== id) });
  return undefined;
}

export async function makeDefault(id: string, { settings }: ModelPorts): Promise<void> {
  const current = settings.models();
  if (current.models.some((model) => model.id === id)) await settings.saveModels({ ...current, default: id });
}

/** The models as the page shows them: never a key, only whether one is saved. */
export async function modelViews({ settings, keys }: ModelPorts): Promise<ModelView[]> {
  return Promise.all(settings.models().models.map(async (model) => ({ ...model, label: labelOf(model), hasApiKey: await keys.has(endpointOf(model)) })));
}

// Settings come from the page, so they are checked for their shape before anything keeps them.
export function readModel(value: unknown): ModelSetting | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { id, provider, baseUrl, model } = value as Record<string, unknown>;
  const valid = typeof id === "string" && isProvider(provider) && typeof baseUrl === "string" && typeof model === "string";
  return valid ? { id, provider, baseUrl, model } : undefined;
}

function problemWith({ provider, baseUrl, model }: ModelSetting): string | undefined {
  if (provider === "openai-compatible" && !isWebUrl(baseUrl)) return "Give the endpoint as a URL, such as http://localhost:11434/v1.";
  if (model === "") return "Name the model to use.";
  if (model.length > MAX_MODEL_NAME) return `Keep the model's name under ${MAX_MODEL_NAME} characters.`;
  return undefined;
}

function isWebUrl(text: string): boolean {
  return URL.canParse(text) && ["http:", "https:"].includes(new URL(text).protocol);
}
