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

/** What one call to a model spent, when it ended and how long it took. */
export interface Spending {
  readonly at: number;
  readonly took: number;
  readonly spent: Usage;
}

/** Wraps a model to note what each call to it spends. */
export function metered(model: ModelProvider): { readonly model: ModelProvider; spending(): readonly Spending[] } {
  const spending: Spending[] = [];
  return {
    model: {
      ...model,
      async complete(system, messages, listener) {
        const started = Date.now();
        const completion = await model.complete(system, messages, listener);
        spending.push({ at: Date.now(), took: Date.now() - started, spent: completion.usage });
        return completion;
      },
    },
    spending: () => spending,
  };
}
