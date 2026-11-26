import { EMPTY_STATE, type App, type State, type Turn, type Version } from "./state.ts";
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
  const apps = state.apps.map((app) => ("versions" in app ? app : versioned(app as unknown as UnversionedApp)));
  return { ...state, spent: counted(state.spent), apps: apps.map(withThinkingCounted) };
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
