import OpenAI from "openai";
import type { ModelProvider } from "../../engine/ports.ts";
import { NO_USAGE, type Usage } from "../../engine/usage.ts";

// Room for a whole routes.ts. No sampling settings: current Claude models reject them.
const MAX_REPLY_TOKENS = 16_000;

export interface ModelSettings {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

/** Any endpoint that speaks OpenAI's chat completions API: OpenAI, Anthropic, OpenRouter, Ollama. */
export function openAiCompatibleModel({ baseUrl, apiKey, model }: ModelSettings): ModelProvider {
  const client = new OpenAI({ baseURL: baseUrl, apiKey });
  return {
    name: model,
    // Streamed, so people can watch the code being written.
    async complete(system, messages, onText) {
      const stream = await client.chat.completions.create({
        model,
        max_completion_tokens: MAX_REPLY_TOKENS,
        messages: [{ role: "system", content: system }, ...messages],
        stream: true,
        stream_options: { include_usage: true },
      });
      let text = "";
      let finish: string | null = null;
      // Some compatible servers leave usage out. Their replies count as free rather than failing.
      let usage: Usage = NO_USAGE;
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        const piece = choice?.delta.content ?? "";
        if (piece !== "") onText?.(piece);
        text += piece;
        finish = choice?.finish_reason ?? finish;
        if (chunk.usage) usage = { input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens };
      }
      if (finish === "length") throw new Error(`The model's reply was cut off at ${MAX_REPLY_TOKENS} tokens.`);
      if (text === "") throw new Error("The model sent an empty reply.");
      return { text, usage };
    },
  };
}

/**
 * The models an endpoint offers, which proves the key without spending tokens. Failures are said in plain
 * words, never in the provider's own, which can quote part of the key.
 */
export async function listModels({ baseUrl, apiKey }: Omit<ModelSettings, "model">): Promise<string[]> {
  const client = new OpenAI({ baseURL: baseUrl, apiKey, maxRetries: 0, timeout: 10_000 });
  try {
    const ids: string[] = [];
    for await (const model of client.models.list()) ids.push(model.id);
    return ids;
  } catch (error) {
    if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) throw new Error("The provider refused the key.");
    if (error instanceof OpenAI.APIConnectionError) throw new Error(`Mayfly cannot reach ${baseUrl}.`);
    if (error instanceof OpenAI.APIError) throw new Error(`The provider answered with an error (${error.status ?? "no status"}).`);
    throw error;
  }
}

/** Reads MAYFLY_MODEL_BASE_URL, MAYFLY_MODEL_API_KEY and MAYFLY_MODEL. See .env.example. */
export function modelSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): ModelSettings {
  return { baseUrl: required(env, "MAYFLY_MODEL_BASE_URL"), apiKey: required(env, "MAYFLY_MODEL_API_KEY"), model: required(env, "MAYFLY_MODEL") };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Set ${name}. See .env.example.`);
  return value;
}
