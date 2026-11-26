import { randomBytes } from "node:crypto";
import { appUrl } from "../core/app-url.ts";
import { appObjects } from "./app-objects.ts";
import { generateApp, type Ask, type Attempt, type Generation } from "./generate.ts";
import type { Ports } from "./ports.ts";
import { newPassword, newSecret } from "./secrets.ts";
import { findApp, findVersion, runningVersion, withApp, withoutApp, type App, type Owner, type State, type Turn, type Version } from "./state.ts";
import { UNWATCHED, type Watcher } from "./step.ts";
import { addUsage, metered, NO_USAGE, type Usage } from "./usage.ts";

const FIRST_PORT = 18100;
// What Mayfly says when the model said nothing after the code.
const MADE = "Your app is ready.";
const CHANGED = "Done. Your app has the change.";

/** A version as a shell shows it, without its code, which the shell asks for when it needs it. */
export type VersionView = Omit<Version, "routes" | "image">;

/** What a shell shows of an app. Never its secrets. */
export interface AppView {
  readonly name: string;
  readonly url: string;
  /** The version running now, or null while no attempt has passed. */
  readonly head: string | null;
  readonly versions: readonly VersionView[];
  readonly conversation: readonly Turn[];
  readonly spent: Usage;
}

export interface Engine {
  /** Has the model write an app for the description, and runs it behind sign-in once an attempt passes. Every attempt is kept. */
  create(description: string, watch?: Watcher): Promise<AppView>;
  /** Has the model change an app as asked. An attempt that passes replaces the running one at the same URL. Every attempt is kept. */
  change(name: string, request: string, watch?: Watcher): Promise<AppView>;
  /** The code of one version of an app. */
  code(name: string, version: string): Promise<string>;
  list(): Promise<AppView[]>;
  remove(name: string): Promise<void>;
  /** Who signs in to the apps. Created on first use. */
  owner(): Promise<Owner>;
  /** What the model has spent on every app, including removed ones and attempts that failed. */
  spent(): Promise<Usage>;
}

export function createEngine({ store, deployer, identity, model, builder }: Ports): Engine {
  async function generate(ask: Ask, watch: Watcher): Promise<Generation> {
    const meter = metered(model);
    try {
      return await generateApp(ask, { model: meter.model, builder, watch });
    } catch (error) {
      // Cut short by the model's service or by Podman, the attempts still cost what the model wrote.
      await store.save(spend(await store.load(), meter.spent(), "change" in ask ? ask.app.name : undefined));
      throw error;
    }
  }

  /** Keeps every attempt as a version and the exchange in the conversation, then runs the attempt that passed. */
  async function record(request: string, { name, attempts }: Generation, base: string | null, started: number, watch: Watcher): Promise<AppView> {
    const state = withOwner(await store.load());
    const app = findApp(state, name) ?? newApp(state, name);
    const versions = chain(attempts, request, base);
    const last = versions.at(-1);
    const passed = last?.problem === null ? last : undefined;
    const spent = attempts.reduce((sum, attempt) => addUsage(sum, attempt.spent), NO_USAGE);
    const reply: Turn = { from: "mayfly", text: replyFor(app, versions), versions: versions.map((version) => version.id), took: Date.now() - started };
    const next: App = {
      ...app,
      versions: [...app.versions, ...versions],
      head: passed?.id ?? app.head,
      conversation: [...app.conversation, { from: "person", text: request }, reply],
      spent: addUsage(app.spent, spent),
    };
    const nextState = spend(withApp(state, next), spent);
    if (passed !== undefined) {
      watch({ kind: "deploying" });
      await identity.sync(nextState);
      await deployer.deploy(appObjects(next, passed.image, identity.settingsFor(next)));
    }
    await store.save(nextState);
    return appView(next);
  }

  return {
    async create(description, watch = UNWATCHED) {
      const started = Date.now();
      const taken = (await store.load()).apps.map((app) => app.name);
      return record(description, await generate({ description, taken }, watch), null, started, watch);
    },

    async change(name, request, watch = UNWATCHED) {
      const started = Date.now();
      const app = existingApp(await store.load(), name);
      // The running code, or for an app that never ran, its latest attempt that had any.
      const base = runningVersion(app) ?? app.versions.findLast((version) => version.routes !== "");
      const generation = await generate({ change: request, app: { name, routes: base?.routes ?? "" } }, watch);
      return record(request, generation, base?.id ?? null, started, watch);
    },

    async code(name, id) {
      const version = findVersion(existingApp(await store.load(), name), id);
      if (version === undefined) throw new Error(`${name} has no version ${id}`);
      return version.routes;
    },

    async list() {
      return (await store.load()).apps.map(appView);
    },

    async remove(name) {
      const state = await store.load();
      const app = existingApp(state, name);
      const running = runningVersion(app);
      if (running !== undefined) await deployer.remove(appObjects(app, running.image, identity.settingsFor(app)));
      const next = withoutApp(state, name);
      await identity.sync(next);
      await store.save(next);
    },

    async owner() {
      const state = await store.load();
      if (state.owner !== null) return state.owner;
      const next = withOwner(state);
      await store.save(next);
      return next.owner;
    },

    async spent() {
      return (await store.load()).spent;
    },
  };
}

function existingApp(state: State, name: string): App {
  const app = findApp(state, name);
  if (app === undefined) throw new Error(`no app named ${name}`);
  return app;
}

function withOwner(state: State): State & { readonly owner: Owner } {
  const owner = state.owner ?? { email: "owner@mayfly.local", username: "owner", password: newPassword() };
  return { ...state, owner };
}

/** A new app gets its own port and secrets, which it keeps for good, so its URL and sessions survive changes. */
function newApp(state: State, name: string): App {
  const port = { hostPort: freePort(state), clientSecret: newSecret(), cookieSecret: newSecret() };
  return { name, ...port, versions: [], head: null, conversation: [], spent: NO_USAGE };
}

function freePort(state: State): number {
  const taken = new Set(state.apps.map((app) => app.hostPort));
  let port = FIRST_PORT;
  while (taken.has(port)) port++;
  return port;
}

/** The attempts as versions, each starting from the one before, and the first from the base. */
function chain(attempts: readonly Attempt[], request: string, base: string | null): Version[] {
  const versions: Version[] = [];
  for (const [index, attempt] of attempts.entries()) {
    versions.push({ id: randomBytes(4).toString("hex"), parent: versions.at(-1)?.id ?? base, request, attempt: index + 1, ...attempt });
  }
  return versions;
}

function replyFor(app: App, versions: readonly Version[]): string {
  const last = versions.at(-1);
  if (last?.problem === null) return last.summary || (app.head === null ? MADE : CHANGED);
  const unchanged = app.head === null ? "" : " Your app is as it was.";
  return `It still failed after ${versions.length} attempts.${unchanged} The last problem was:\n\n${last?.problem ?? ""}`;
}

/** Counts tokens against the total and, when it names one, against an app. */
function spend(state: State, spent: Usage, name?: string): State {
  const app = name === undefined ? undefined : findApp(state, name);
  const charged = app === undefined ? state : withApp(state, { ...app, spent: addUsage(app.spent, spent) });
  return { ...charged, spent: addUsage(state.spent, spent) };
}

function appView(app: App): AppView {
  const versions = app.versions.map(({ routes: _routes, image: _image, ...view }) => view);
  return { name: app.name, url: appUrl(app.hostPort), head: app.head, versions, conversation: app.conversation, spent: app.spent };
}
