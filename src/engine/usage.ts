import type { ModelProvider } from "./ports.ts";

/** Tokens a model read, wrote in its reply, and spent thinking when its provider says so. Thinking is billed like writing. */
export interface Usage {
  readonly input: number;
  readonly output: number;
  readonly thinking: number;
}

export const NO_USAGE: Usage = { input: 0, output: 0, thinking: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return { input: a.input + b.input, output: a.output + b.output, thinking: a.thinking + b.thinking };
}

/** Wraps a model to count what it spends. */
export function metered(model: ModelProvider): { readonly model: ModelProvider; spent(): Usage } {
  let spent = NO_USAGE;
  return {
    model: {
      name: model.name,
      async complete(system, messages, listener) {
        const completion = await model.complete(system, messages, listener);
        spent = addUsage(spent, completion.usage);
        return completion;
      },
    },
    spent: () => spent,
  };
}
