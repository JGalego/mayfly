import { randomUUID } from "node:crypto";
import type { ModelView } from "./messages.ts";
import { endpointOf, isProvider, nameOf, type Models, type ModelSetting } from "./settings.ts";

const MAX_MODEL_NAME = 200;
const MAX_NAME = 40;

/** Where the models are kept, and the API keys, each for the endpoint it was given for. */
export interface ModelPorts {
  readonly settings: { models(): Models; saveModels(models: Models): Promise<void> };
  readonly keys: { has(endpoint: string): Promise<boolean>; save(endpoint: string, key: string): Promise<void> };
}

/** Adds a model, or changes one, and keeps its key if one came with it. Returns what is wrong with it, if anything. */
export async function saveModel(setting: ModelSetting, apiKey: string, { settings, keys }: ModelPorts): Promise<string | undefined> {
  const cleaned = cleanedUp(setting);
  const current = settings.models();
  const problem = problemWith(cleaned) ?? nameTaken(cleaned, current.models);
  if (problem !== undefined) return problem;
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
  if (id === current.default) return "Make another model the default before removing this one";
  await settings.saveModels({ ...current, models: current.models.filter((model) => model.id !== id) });
  return undefined;
}

export async function makeDefault(id: string, { settings }: ModelPorts): Promise<void> {
  const current = settings.models();
  if (current.models.some((model) => model.id === id)) await settings.saveModels({ ...current, default: id });
}

/** The models as the page shows them: never a key, only whether one is saved. */
export async function modelViews({ settings, keys }: ModelPorts): Promise<ModelView[]> {
  return Promise.all(settings.models().models.map(async (model) => ({ ...model, label: nameOf(model), hasApiKey: await keys.has(endpointOf(model)) })));
}

// Settings come from the page, so they are checked for their shape before anything keeps them.
export function readModel(value: unknown): ModelSetting | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { id, provider, baseUrl, model, name } = value as Record<string, unknown>;
  const valid = typeof id === "string" && isProvider(provider) && typeof baseUrl === "string" && typeof model === "string" && (name === undefined || typeof name === "string");
  return valid ? { id, provider, baseUrl, model, ...(name === undefined ? {} : { name }) } : undefined;
}

// A blank name is no name: the model goes back to being called by its label.
function cleanedUp({ name, ...setting }: ModelSetting): ModelSetting {
  const trimmed = name?.trim() ?? "";
  return { ...setting, baseUrl: setting.baseUrl.trim(), model: setting.model.trim(), ...(trimmed === "" ? {} : { name: trimmed }) };
}

function problemWith({ provider, baseUrl, model, name }: ModelSetting): string | undefined {
  if (provider === "openai-compatible" && !isWebUrl(baseUrl)) return "Give the endpoint as a URL like `http://localhost:11434/v1`";
  if (model === "") return "Name the model to use";
  if (model.length > MAX_MODEL_NAME) return `Keep the model's name under ${MAX_MODEL_NAME} characters`;
  if (name !== undefined && name.length > MAX_NAME) return `Keep the name under ${MAX_NAME} characters`;
  return undefined;
}

// /model finds a model by what the page calls it, so no two can share that.
function nameTaken(setting: ModelSetting, models: readonly ModelSetting[]): string | undefined {
  const wanted = nameOf(setting).toLowerCase();
  const other = models.find((model) => model.id !== setting.id && nameOf(model).toLowerCase() === wanted);
  return other === undefined ? undefined : `Another model is already called \`${nameOf(other)}\``;
}

function isWebUrl(text: string): boolean {
  return URL.canParse(text) && ["http:", "https:"].includes(new URL(text).protocol);
}
