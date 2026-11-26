import { NO_USAGE, type Usage } from "./usage.ts";

/** The person on this machine. Every app lets them in. */
export interface Owner {
  readonly email: string;
  readonly username: string;
  readonly password: string;
}

/** One attempt at an app's code, kept whether or not it passed: a commit in the app's history. */
export type Version = VersionDetails &
  (
    | { readonly problem: null; /** The image it was built into. */ readonly image: string }
    | { /** Why it failed. */ readonly problem: string; readonly image: null }
  );

interface VersionDetails {
  readonly id: string;
  /** The version it started from: the one running when the person asked, or the attempt it repairs. */
  readonly parent: string | null;
  /** What the person asked for. */
  readonly request: string;
  /** Who made it: the model, or the person who edited the code by hand. */
  readonly by: Author;
  readonly attempt: number;
  /** Empty when the model's reply held no usable code. */
  readonly routes: string;
  /** What the model thought before it wrote this, when its provider shares that. */
  readonly thinking?: string;
  /** What the model told the person about it. */
  readonly summary: string;
  readonly spent: Usage;
  /** When it was made, in milliseconds since the epoch. */
  readonly at: number;
}

export interface Author {
  readonly kind: "model" | "person";
  /** The model as people know it, such as "OpenAI · gpt-6.2-sol", or the person's email. */
  readonly name: string;
}

/** One message in an app's conversation. Mayfly's replies name the versions made for the request before them. */
export type Turn =
  | { readonly from: "person"; readonly text: string; readonly at: number }
  | { readonly from: "mayfly"; readonly text: string; readonly versions: readonly string[]; readonly took: number; readonly at: number };

/** An app, everything it has been, and what it keeps across deploys: its port and its secrets. */
export interface App {
  readonly name: string;
  readonly hostPort: number;
  readonly clientSecret: string;
  readonly cookieSecret: string;
  /** The model that writes its changes, or null for the default one. */
  readonly model: string | null;
  /** A favourite of the person's, which they want near the top. */
  readonly starred: boolean;
  /** Every attempt at its code, oldest first, failed ones included. */
  readonly versions: readonly Version[];
  /** The version running now, or null while no attempt has passed. */
  readonly head: string | null;
  readonly conversation: readonly Turn[];
  readonly spent: Usage;
}

/** One call to a model: when it ended, for which app, to which model, what it spent and how it went. Kept when the app is removed. */
export interface ModelCall {
  readonly at: number;
  /** How long it took, in milliseconds. Calls kept before Mayfly timed them have none. */
  readonly took?: number;
  /** The app it was for, or null for a new app that never got a name. */
  readonly app: string | null;
  /** Who provides the model, such as "OpenAI" or "localhost:11434". */
  readonly provider: string;
  /** The model as people know it, such as "OpenAI · gpt-6.2-sol". */
  readonly model: string;
  readonly spent: Usage;
  /** Whether the code it wrote passed its trial. Unknown when the work was cut short, or the version it made is gone. */
  readonly passed?: boolean;
}

export interface State {
  readonly owner: Owner | null;
  readonly apps: readonly App[];
  /** Everything the model has spent, including on removed apps and on attempts that failed. */
  readonly spent: Usage;
  /** Every call to a model, oldest first: the ledger the spending is broken down from. */
  readonly calls: readonly ModelCall[];
}

export const EMPTY_STATE: State = { owner: null, apps: [], spent: NO_USAGE, calls: [] };

/** The role the owner holds, and the only one a new app lets in. */
export const OWNER_ROLE = "owner";

export function findApp(state: State, name: string): App | undefined {
  return state.apps.find((app) => app.name === name);
}

export function findVersion(app: App, id: string | null): Version | undefined {
  return app.versions.find((version) => version.id === id);
}

/** The version running now, if one has passed. */
export function runningVersion(app: App): (Version & { readonly problem: null }) | undefined {
  const version = findVersion(app, app.head);
  return version?.problem === null ? version : undefined;
}

/** Adds the app, or replaces the one with the same name in place. */
export function withApp(state: State, app: App): State {
  const index = state.apps.findIndex((existing) => existing.name === app.name);
  const apps = index === -1 ? [...state.apps, app] : state.apps.with(index, app);
  return { ...state, apps };
}

export function withoutApp(state: State, name: string): State {
  return { ...state, apps: state.apps.filter((app) => app.name !== name) };
}
