import { EMPTY_STATE, type App, type ModelCall, type State, type Turn, type Version } from "./state.ts";
import { NO_USAGE, type Usage } from "./usage.ts";

/** An app as Mayfly saved it before it kept versions: its running image and code, and a conversation. */
interface UnversionedApp {
  readonly manifest: { readonly name: string; readonly image: string };
  readonly hostPort: number;
  readonly clientSecret: string;
  readonly cookieSecret: string;
  readonly routes: string;
  readonly conversation?: readonly { readonly from: "person" | "mayfly"; readonly text: string }[];
  readonly spent?: Usage;
}

/** Reads a state saved by this or an earlier version of Mayfly, so nobody loses their apps on an update. */
export function upgradeState(saved: unknown): State {
  const state = { ...EMPTY_STATE, ...(saved as Partial<State>) };
  const apps = state.apps.map((app) => ("versions" in app ? app : versioned(app as unknown as UnversionedApp))).map(withThinkingCounted);
  const calls = (saved as Partial<State>).calls ?? apps.flatMap(callsOf);
  return { ...state, spent: counted(state.spent), apps, calls: withOutcomes(calls, apps) };
}

// The ledger starts with the calls that made the versions kept before it. Removed apps' calls were not kept.
function callsOf(app: App): ModelCall[] {
  const made = app.versions.filter((version) => version.by.kind === "model");
  return made.map(({ at, by, spent, problem }) => ({ at, app: app.name, provider: providerIn(by.name), model: by.name, spent, passed: problem === null }));
}

// A call kept before outcomes were noted takes the outcome of the version its attempt made: the first by its model after the
// call ended and before the app's next call. A call cut short made none, and a removed app's versions are gone.
function withOutcomes(calls: readonly ModelCall[], apps: readonly App[]): ModelCall[] {
  const nextCall = new Map<string | null, number>();
  const known = calls.toReversed().map((call) => {
    const before = nextCall.get(call.app) ?? Infinity;
    nextCall.set(call.app, call.at);
    if (call.passed !== undefined) return call;
    const made = apps.find((app) => app.name === call.app)?.versions.find((v) => v.by.kind === "model" && v.by.name === call.model && v.at >= call.at && v.at < before);
    return made === undefined ? call : { ...call, passed: made.problem === null };
  });
  return known.toReversed();
}

// Versions name their model as people know it, its provider first: "OpenAI · gpt-6.2-sol".
function providerIn(model: string): string {
  const end = model.indexOf(" · ");
  return end === -1 ? "Unknown" : model.slice(0, end);
}

// Tokens saved before thinking was counted apart are all in the reply's.
function withThinkingCounted(app: App): App {
  const versions = app.versions.map((version): Version => ({ ...version, spent: counted(version.spent) }));
  return { ...app, spent: counted(app.spent), versions };
}

function counted(usage: Partial<Usage>): Usage {
  return { ...NO_USAGE, ...usage };
}

// The running code becomes the app's only version, owned by Mayfly's last reply.
function versioned(app: UnversionedApp): App {
  const id = "00000001";
  const turns = app.conversation ?? [];
  const lastReply = turns.findLastIndex((turn) => turn.from === "mayfly");
  const conversation = turns.map((turn, index): Turn => {
    if (turn.from === "person") return { from: "person", text: turn.text, at: 0 };
    return { from: "mayfly", text: turn.text, versions: index === lastReply ? [id] : [], took: 0, at: 0 };
  });
  const version = {
    id,
    parent: null,
    request: turns.find((turn) => turn.from === "person")?.text ?? "",
    by: { kind: "model", name: "the model" } as const,
    attempt: 1,
    routes: app.routes,
    summary: turns[lastReply]?.text ?? "",
    problem: null,
    image: app.manifest.image,
    spent: app.spent ?? NO_USAGE,
    at: 0,
  };
  const { name } = app.manifest;
  const kept = { hostPort: app.hostPort, clientSecret: app.clientSecret, cookieSecret: app.cookieSecret };
  return { name, ...kept, model: null, starred: false, versions: [version], head: id, conversation, spent: version.spent };
}
