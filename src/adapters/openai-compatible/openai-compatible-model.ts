import OpenAI from "openai";
import type { Completion, Listener, Message, ModelProvider } from "../../engine/ports.ts";
import { NO_USAGE, type Usage } from "../../engine/usage.ts";
import { thinkTags, type Parts } from "./think-tags.ts";

// Room for a whole routes.ts. No sampling settings: current Claude models reject them.
const MAX_REPLY_TOKENS = 16_000;

// The SDK wants a key. Local servers that need none ignore this one.
const NO_KEY = "none";

/** Where the model is, and its key when the provider needs one: local providers often do not. */
export interface ModelSettings {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly model: string;
}

/** A provider turned a request down for want of a key, and none was given. */
export class KeyNeeded extends Error {
  constructor() {
    super("The provider needs an API key.");
  }
}

/** Any endpoint that speaks OpenAI's chat completions API: OpenAI, Anthropic, OpenRouter, Ollama. */
export function openAiCompatibleModel({ baseUrl, apiKey, model }: ModelSettings): ModelProvider {
  const client = new OpenAI({ baseURL: baseUrl, apiKey: apiKey ?? NO_KEY });
  return {
    name: model,
    provider: URL.canParse(baseUrl) ? new URL(baseUrl).host : baseUrl,
    // Streamed, so people can watch the code being written, and the thinking where the provider shares it.
    async complete(system, messages, listener = {}) {
      const { finish, ...completion } = await plainly({ baseUrl, apiKey, model }, async () => {
        const stream = await client.chat.completions.create({
          model,
          max_completion_tokens: MAX_REPLY_TOKENS,
          messages: [{ role: "system", content: system }, ...messages.map(forOpenAi)],
          stream: true,
          stream_options: { include_usage: true },
        });
        return gather(stream, listener);
      });
      if (finish === "length") throw new Error(`The model's reply was cut off at ${MAX_REPLY_TOKENS} tokens.`);
      if (completion.text === "") throw new Error("The model sent an empty reply.");
      return completion;
    },
  };
}

/** A message as OpenAI's API takes it: images as data URLs. Replies are always text. */
function forOpenAi({ role, content }: Message): OpenAI.ChatCompletionMessageParam {
  if (typeof content === "string") return { role, content };
  if (role === "assistant") return { role, content: content.map((part) => (part.type === "text" ? part.text : "")).join("") };
  return {
    role,
    content: content.map((part): OpenAI.ChatCompletionContentPart => (part.type === "text" ? { type: "text", text: part.text } : { type: "image_url", image_url: { url: `data:${part.mediaType};base64,${part.data}` } })),
  };
}

/** A streamed reply put together, passing each piece of text and thinking on as it arrives, and why it ended. */
async function gather(stream: AsyncIterable<OpenAI.ChatCompletionChunk>, listener: Listener): Promise<Completion & { readonly finish: string | null }> {
  const reply = { text: "", thinking: "" };
  const take = ({ text, thinking }: Parts): void => {
    if (thinking !== "") listener.thinking?.(thinking);
    if (text !== "") listener.text?.(text);
    reply.text += text;
    reply.thinking += thinking;
  };
  const tags = thinkTags();
  let finish: string | null = null;
  // Some compatible servers leave usage out. Their replies count as free rather than failing.
  let usage: Usage = NO_USAGE;
  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (choice !== undefined) {
      take({ text: "", thinking: thinkingIn(choice.delta) });
      take(tags.read(choice.delta.content ?? ""));
      finish = choice.finish_reason ?? finish;
    }
    if (chunk.usage) usage = usageOf(chunk.usage);
  }
  take(tags.end());
  return { ...reply, usage, finish };
}

// The reply's tokens include the thinking's, which providers that count it say apart.
function usageOf({ prompt_tokens, completion_tokens, completion_tokens_details }: OpenAI.CompletionUsage): Usage {
  const thinking = completion_tokens_details?.reasoning_tokens ?? 0;
  return { input: prompt_tokens, output: completion_tokens - thinking, thinking };
}

/**
 * The thinking in a piece of the stream, which OpenAI's API leaves out. Compatible servers that share it do so in a field of their own:
 * DeepSeek and vLLM in reasoning_content, OpenRouter in reasoning. Others put it in the text between <think> tags.
 */
function thinkingIn(delta: object): string {
  const { reasoning_content: content, reasoning } = delta as { readonly reasoning_content?: unknown; readonly reasoning?: unknown };
  return [content, reasoning].find((value): value is string => typeof value === "string" && value !== "") ?? "";
}

/** The models an endpoint offers, which proves the key, or that none is needed, without spending tokens. */
export async function listModels({ baseUrl, apiKey }: Omit<ModelSettings, "model">): Promise<string[]> {
  const client = new OpenAI({ baseURL: baseUrl, apiKey: apiKey ?? NO_KEY, maxRetries: 0, timeout: 10_000 });
  return plainly({ baseUrl, apiKey }, async () => {
    const ids: string[] = [];
    for await (const model of client.models.list()) ids.push(model.id);
    return ids;
  });
}

/** Runs a call to the provider, saying what went wrong in plain words, never in the provider's own, which can quote part of the key. */
async function plainly<T>({ baseUrl, apiKey, model }: { readonly baseUrl: string; readonly apiKey: string | undefined; readonly model?: string }, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) throw apiKey === undefined ? new KeyNeeded() : new Error("The provider refused the key.");
    if (error instanceof OpenAI.APIConnectionError) throw new Error(`Mayfly cannot reach ${baseUrl}.`);
    if (error instanceof OpenAI.NotFoundError && model !== undefined) throw new Error(`The provider has no model called ${model}.`);
    if (error instanceof OpenAI.RateLimitError) throw new Error("The provider is limiting requests. Try again in a moment.");
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
