import type { Builder, Message, ModelProvider } from "./ports.ts";
import { changeFor, repairFor, requestFor, SYSTEM_PROMPT } from "./prompt.ts";
import { parseReply } from "./reply.ts";
import { UNWATCHED, type Watcher } from "./step.ts";

// Enough for the model to fix what a trial shows it. A model looping on a problem it cannot solve stops here.
const ATTEMPTS = 3;
const MAX_NAME_LENGTH = 40;

/** A new app, which must not take the name of one that exists, or a change to an app, which keeps its name. */
export type Ask =
  | { readonly description: string; readonly taken: readonly string[] }
  | { readonly change: string; readonly app: { readonly name: string; readonly routes: string } };

/** An app that passed its trial, and what the model said about it. */
export interface Generated {
  readonly name: string;
  readonly image: string;
  readonly routes: string;
  readonly summary: string;
}

type Outcome = { readonly ok: true; readonly generated: Generated } | { readonly ok: false; readonly problem: string };

/** Has the model write the app, then builds and trials it, feeding each failure back until it passes. */
export async function generateApp(
  ask: Ask,
  { model, builder, watch = UNWATCHED }: { model: ModelProvider; builder: Builder; watch?: Watcher },
): Promise<Generated> {
  const messages: Message[] = [{ role: "user", content: "change" in ask ? changeFor(ask.app, ask.change) : requestFor(ask.description) }];
  let problem = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    watch({ kind: "writing", attempt });
    const reply = (await model.complete(SYSTEM_PROMPT, messages)).text;
    const outcome = await tryReply(reply, ask, builder, watch);
    if (outcome.ok) return outcome.generated;
    problem = outcome.problem;
    watch({ kind: "failed", problem });
    messages.push({ role: "assistant", content: reply }, { role: "user", content: repairFor(problem) });
  }
  throw new Error(`The app still failed after ${ATTEMPTS} attempts. The last problem was:\n\n${problem}`);
}

async function tryReply(reply: string, ask: Ask, builder: Builder, watch: Watcher): Promise<Outcome> {
  const parsed = parseReply(reply);
  if (!parsed.ok) return parsed;
  watch({ kind: "wrote", routes: parsed.routes });
  watch({ kind: "trying" });
  const name = "change" in ask ? ask.app.name : unusedName(parsed.name, ask.taken);
  const image = await builder.build(name, parsed.routes);
  const trial = await builder.trial(image);
  return trial.ok ? { ok: true, generated: { name, image, routes: parsed.routes, summary: parsed.summary } } : trial;
}

/** Models pick obvious names, and a second "notes" must not replace the first. */
function unusedName(name: string, taken: readonly string[]): string {
  let candidate = name;
  for (let n = 2; taken.includes(candidate); n++) candidate = `${name.slice(0, MAX_NAME_LENGTH - `-${n}`.length)}-${n}`;
  return candidate;
}
