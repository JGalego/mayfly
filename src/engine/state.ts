import type { Manifest } from "../core/manifest.ts";

/** The person on this machine. Every app lets them in. */
export interface Owner {
  readonly email: string;
  readonly username: string;
  readonly password: string;
}

/** A deployed app and what it keeps across deploys: its port and its secrets. */
export interface App {
  readonly manifest: Manifest;
  readonly hostPort: number;
  readonly clientSecret: string;
  readonly cookieSecret: string;
}

export interface State {
  readonly owner: Owner | null;
  readonly apps: readonly App[];
}

export const EMPTY_STATE: State = { owner: null, apps: [] };

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
