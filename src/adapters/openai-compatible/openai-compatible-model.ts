import OpenAI from "openai";
import type { ModelProvider } from "../../engine/ports.ts";

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
    async complete(system, messages) {
      const response = await client.chat.completions.create({
        model,
        max_completion_tokens: MAX_REPLY_TOKENS,
        messages: [{ role: "system", content: system }, ...messages],
      });
      const choice = response.choices[0];
      if (choice?.finish_reason === "length") throw new Error(`The model's reply was cut off at ${MAX_REPLY_TOKENS} tokens.`);
      const text = choice?.message.content;
      if (!text) throw new Error("The model sent an empty reply.");
      // Some compatible servers leave usage out. Their replies count as free rather than failing.
      return { text, usage: { input: response.usage?.prompt_tokens ?? 0, output: response.usage?.completion_tokens ?? 0 } };
    },
  };
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
