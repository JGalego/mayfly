/** Who writes the apps: OpenAI, or any other service that speaks its API. */
export const PROVIDERS = { openai: "OpenAI", "openai-compatible": "OpenAI-compatible" } as const;

export type Provider = keyof typeof PROVIDERS;

/** A model Mayfly can write apps with: who provides it, where, and its name there. */
export interface ModelSetting {
  readonly id: string;
  readonly provider: Provider;
  /** Used only by an OpenAI-compatible provider. OpenAI's endpoint is fixed. */
  readonly baseUrl: string;
  readonly model: string;
  /** What the person calls it, if they named it. Versions and usage keep its label, which says what it is. */
  readonly name?: string;
}

/** Every model the person set up, and the one new apps use. */
export interface Models {
  readonly models: readonly ModelSetting[];
  readonly default: string;
}

const OPENAI_ENDPOINT = "https://api.openai.com/v1";

const OPENAI: ModelSetting = { id: "openai", provider: "openai", baseUrl: "", model: "gpt-6.2-sol" };

/** What Mayfly starts with: OpenAI's gpt-6.2-sol. */
export const FIRST_MODELS: Models = { models: [OPENAI], default: OPENAI.id };

/** Where the model's requests go, and so the only place its API key is sent. */
export function endpointOf(setting: ModelSetting): string {
  return setting.provider === "openai" ? OPENAI_ENDPOINT : setting.baseUrl;
}

/** The model as people know it: "OpenAI · gpt-6.2-sol", or with the server for another provider. */
export function labelOf(setting: ModelSetting): string {
  return `${providerOf(setting)} · ${setting.model}`;
}

/** What the page calls a model: the name the person gave it, or its label. */
export function nameOf(setting: ModelSetting): string {
  return setting.name ?? labelOf(setting);
}

/** Who provides a model: OpenAI, or the server another provider runs on. */
export function providerOf({ provider, baseUrl }: Pick<ModelSetting, "provider" | "baseUrl">): string {
  if (provider === "openai") return PROVIDERS.openai;
  return URL.canParse(baseUrl) ? new URL(baseUrl).host : baseUrl;
}

/** The model with this id, or the default one. */
export function modelFor({ models, default: fallback }: Models, id: string | null): ModelSetting {
  return models.find((setting) => setting.id === id) ?? models.find((setting) => setting.id === fallback) ?? OPENAI;
}

export function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && Object.hasOwn(PROVIDERS, value);
}
