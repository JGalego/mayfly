/** Who writes the apps: OpenAI, or any other service that speaks its API. */
export const PROVIDERS = { openai: "OpenAI", "openai-compatible": "OpenAI-compatible" } as const;

export type Provider = keyof typeof PROVIDERS;

export interface ModelChoice {
  readonly provider: Provider;
  /** Used only by an OpenAI-compatible provider. OpenAI's endpoint is fixed. */
  readonly baseUrl: string;
  readonly model: string;
}

const OPENAI_ENDPOINT = "https://api.openai.com/v1";

/** Where the model's requests go, and so the only place its API key is sent. */
export function endpointOf(choice: ModelChoice): string {
  return choice.provider === "openai" ? OPENAI_ENDPOINT : choice.baseUrl;
}

export function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && Object.hasOwn(PROVIDERS, value);
}
