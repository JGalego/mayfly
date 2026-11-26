import type { Builder, Message, ModelProvider } from "./ports.ts";
import { changeFor, repairFor, requestFor, SYSTEM_PROMPT } from "./prompt.ts";
import { parseReply } from "./reply.ts";
import { UNWATCHED, type Watcher } from "./step.ts";
import type { Usage } from "./usage.ts";

// Enough for the model to fix what a trial shows it. A model looping on a problem it cannot solve stops here.
const ATTEMPTS = 3;
const MAX_NAME_LENGTH = 40;
// What a new app is called when the model never gave it a usable name.
const UNNAMED = "new-app";

/** A new app, which must not take the name of one that exists, or a change to an app, which keeps its name. */
export type Ask =
  | { readonly description: string; readonly taken: readonly string[] }
  | { readonly change: string; readonly app: { readonly name: string; readonly routes: string } };

type Outcome = { readonly problem: null; readonly image: string } | { readonly problem: string; readonly image: null };

/** One go at the code: what the model wrote, and whether it passed its trial. */
export type Attempt = { readonly routes: string; readonly summary: string; readonly spent: Usage; readonly at: number } & Outcome;

/** The app's name and every attempt at it. The last attempt is the one that passed, if any did. */
export interface Generation {
  readonly name: string;
  readonly attempts: readonly Attempt[];
}

/** Has the model write the app, then builds and trials it, feeding each failure back until one passes or the attempts run out. */
export async function generateApp(
  ask: Ask,
  { model, builder, watch = UNWATCHED }: { model: ModelProvider; builder: Builder; watch?: Watcher },
): Promise<Generation> {
  const messages: Message[] = [{ role: "user", content: "change" in ask ? changeFor(ask.app, ask.change) : requestFor(ask.description) }];
  const taken = "change" in ask ? [] : ask.taken;
  let name = "change" in ask ? ask.app.name : undefined;
  const attempts: Attempt[] = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    watch({ kind: "writing", attempt });
    let draft = "";
    const { text: reply, usage } = await model.complete(SYSTEM_PROMPT, messages, (text) => watch({ kind: "draft", text: (draft += text) }));
    const parsed = parseReply(reply);
    const outcome: Outcome = parsed.ok ? await tryCode((name ??= unusedName(parsed.name, taken)), parsed.routes, builder, watch) : { problem: parsed.problem, image: null };
    attempts.push({ routes: parsed.ok ? parsed.routes : "", summary: parsed.ok ? parsed.summary : "", spent: usage, at: Date.now(), ...outcome });
    if (outcome.problem === null) break;
    watch({ kind: "failed", problem: outcome.problem });
    messages.push({ role: "assistant", content: reply }, { role: "user", content: repairFor(outcome.problem) });
  }
  return { name: name ?? unusedName(UNNAMED, taken), attempts };
}

async function tryCode(name: string, routes: string, builder: Builder, watch: Watcher): Promise<Outcome> {
  watch({ kind: "wrote", routes });
  watch({ kind: "building" });
  const image = await builder.build(name, routes);
  watch({ kind: "trying" });
  const trial = await builder.trial(image);
  return trial.ok ? { problem: null, image } : { problem: trial.problem, image: null };
}

/** Models pick obvious names, and a second "notes" must not replace the first. */
function unusedName(name: string, taken: readonly string[]): string {
  let candidate = name;
  for (let n = 2; taken.includes(candidate); n++) candidate = `${name.slice(0, MAX_NAME_LENGTH - `-${n}`.length)}-${n}`;
  return candidate;
}
