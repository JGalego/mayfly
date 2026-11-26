import type { ModelProvider } from "./ports.ts";

/** Tokens a model read and wrote. */
export interface Usage {
  readonly input: number;
  readonly output: number;
}

export const NO_USAGE: Usage = { input: 0, output: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return { input: a.input + b.input, output: a.output + b.output };
}

/** Wraps a model to count what it spends. */
export function metered(model: ModelProvider): { readonly model: ModelProvider; spent(): Usage } {
  let spent = NO_USAGE;
  return {
    model: {
      async complete(system, messages) {
        const completion = await model.complete(system, messages);
        spent = addUsage(spent, completion.usage);
        return completion;
      },
    },
    spent: () => spent,
  };
}
