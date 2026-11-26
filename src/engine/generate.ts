import type { Builder, Message, ModelProvider } from "./ports.ts";
import { changeFor, repairFor, requestFor, SYSTEM_PROMPT } from "./prompt.ts";
import { applyEdits, type Applied } from "./edits.ts";
import { parseReply, type Code } from "./reply.ts";
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
export type Attempt = Tried & { readonly spent: Usage; readonly at: number };

/** The code an attempt ended up with, empty when the reply had none that could be used. */
type Tried = { readonly routes: string; readonly summary: string } & Outcome;

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
  const nameFor = (proposed: string): string => (name ??= unusedName(proposed, taken));
  // The code the next edits apply to: the app's, then each attempt's that had any.
  let current = "change" in ask ? ask.app.routes : "";
  const attempts: Attempt[] = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    watch({ kind: "writing", attempt });
    let draft = "";
    const { text: reply, usage } = await model.complete(SYSTEM_PROMPT, messages, (text) => watch({ kind: "draft", text: (draft += text) }));
    const tried = await tryReply(reply, current, nameFor, builder, watch);
    attempts.push({ ...tried, spent: usage, at: Date.now() });
    if (tried.problem === null) break;
    current = tried.routes || current;
    watch({ kind: "failed", problem: tried.problem });
    const edited = reply.includes("<<<<<<< SEARCH");
    messages.push({ role: "assistant", content: reply }, { role: "user", content: repairFor(tried.problem, edited ? current : undefined) });
  }
  return { name: name ?? unusedName(UNNAMED, taken), attempts };
}

async function tryReply(reply: string, current: string, nameFor: (proposed: string) => string, builder: Builder, watch: Watcher): Promise<Tried> {
  const parsed = parseReply(reply);
  if (!parsed.ok) return unusable(parsed.problem);
  const code = resolve(parsed.code, current);
  if (!code.ok) return unusable(code.problem);
  return { routes: code.routes, summary: parsed.summary, ...(await tryCode(nameFor(parsed.name), code.routes, builder, watch)) };
}

/** The whole code a reply gives, applying its edits to the code there is. */
function resolve(code: Code, current: string): Applied {
  if ("routes" in code) return { ok: true, routes: code.routes };
  if (current === "") return { ok: false, problem: "There is no code yet to edit. Reply with the whole of routes.ts." };
  return applyEdits(current, code.edits);
}

function unusable(problem: string): Tried {
  return { routes: "", summary: "", problem, image: null };
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
