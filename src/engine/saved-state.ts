import { EMPTY_STATE, type App, type State, type Turn } from "./state.ts";
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
  return { ...state, apps: state.apps.map((app) => ("versions" in app ? app : versioned(app as unknown as UnversionedApp))) };
}

// The running code becomes the app's only version, owned by Mayfly's last reply.
function versioned(app: UnversionedApp): App {
  const id = "00000001";
  const turns = app.conversation ?? [];
  const lastReply = turns.findLastIndex((turn) => turn.from === "mayfly");
  const conversation = turns.map((turn, index): Turn => {
    if (turn.from === "person") return { from: "person", text: turn.text };
    return { from: "mayfly", text: turn.text, versions: index === lastReply ? [id] : [], took: 0 };
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
  return { name, hostPort: app.hostPort, clientSecret: app.clientSecret, cookieSecret: app.cookieSecret, versions: [version], head: id, conversation, spent: version.spent };
}
