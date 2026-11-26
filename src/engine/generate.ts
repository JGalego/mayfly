import type { Manifest } from "../core/manifest.ts";
import type { Builder, Message, ModelProvider } from "./ports.ts";
import { repairFor, requestFor, SYSTEM_PROMPT } from "./prompt.ts";
import { parseReply } from "./reply.ts";

// Enough for the model to fix what a trial shows it. A model looping on a problem it cannot solve stops here.
const ATTEMPTS = 3;

type Outcome = { readonly ok: true; readonly manifest: Manifest } | { readonly ok: false; readonly problem: string };

/** Has the model write the app, then builds and trials it, feeding each failure back until it passes. */
export async function generateApp(description: string, { model, builder }: { model: ModelProvider; builder: Builder }): Promise<Manifest> {
  const messages: Message[] = [{ role: "user", content: requestFor(description) }];
  let problem = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const reply = await model.complete(SYSTEM_PROMPT, messages);
    const outcome = await tryReply(reply, builder);
    if (outcome.ok) return outcome.manifest;
    problem = outcome.problem;
    messages.push({ role: "assistant", content: reply }, { role: "user", content: repairFor(problem) });
  }
  throw new Error(`The app still failed after ${ATTEMPTS} attempts. The last problem was:\n\n${problem}`);
}

async function tryReply(reply: string, builder: Builder): Promise<Outcome> {
  const parsed = parseReply(reply);
  if (!parsed.ok) return parsed;
  const image = await builder.build(parsed.name, parsed.routes);
  const trial = await builder.trial(image);
  return trial.ok ? { ok: true, manifest: { name: parsed.name, image } } : trial;
}
