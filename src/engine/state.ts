import type { Manifest } from "../core/manifest.ts";
import { NO_USAGE, type Usage } from "./usage.ts";

/** The person on this machine. Every app lets them in. */
export interface Owner {
  readonly email: string;
  readonly username: string;
  readonly password: string;
}

/** One message in the conversation that made and changed an app. */
export interface Turn {
  readonly from: "person" | "mayfly";
  readonly text: string;
}

/** A deployed app and what it keeps across deploys: its port, its secrets, its code and its conversation. */
export interface App {
  readonly manifest: Manifest;
  readonly hostPort: number;
  readonly clientSecret: string;
  readonly cookieSecret: string;
  /** The code running now, which the model starts from when asked for a change. */
  readonly routes: string;
  readonly conversation: readonly Turn[];
  readonly spent: Usage;
}

export interface State {
  readonly owner: Owner | null;
  readonly apps: readonly App[];
  /** Everything the model has spent, including on removed apps and on attempts that failed. */
  readonly spent: Usage;
}

export const EMPTY_STATE: State = { owner: null, apps: [], spent: NO_USAGE };

/** The role the owner holds, and the only one a new app lets in. */
export const OWNER_ROLE = "owner";

export function findApp(state: State, name: string): App | undefined {
  return state.apps.find((app) => app.manifest.name === name);
}

/** Adds the app, or replaces the one with the same name in place. */
export function withApp(state: State, app: App): State {
  const index = state.apps.findIndex((existing) => existing.manifest.name === app.manifest.name);
  const apps = index === -1 ? [...state.apps, app] : state.apps.with(index, app);
  return { ...state, apps };
}

export function withoutApp(state: State, name: string): State {
  return { ...state, apps: state.apps.filter((app) => app.manifest.name !== name) };
}
