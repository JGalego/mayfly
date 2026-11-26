import { appUrl } from "../core/app-url.ts";
import { appObjects } from "./app-objects.ts";
import { generateApp, type Ask, type Generated } from "./generate.ts";
import type { Ports } from "./ports.ts";
import { newPassword, newSecret } from "./secrets.ts";
import { findApp, withApp, withoutApp, type App, type Owner, type State, type Turn } from "./state.ts";
import { UNWATCHED, type Watcher } from "./step.ts";
import { addUsage, metered, NO_USAGE, type Usage } from "./usage.ts";

const FIRST_PORT = 18100;
// What the conversation says when the model said nothing after the code.
const MADE = "Your app is ready.";
const CHANGED = "Done. Your app has the change.";

/** What a shell shows of an app. Never its secrets. */
export interface AppView {
  readonly name: string;
  readonly url: string;
  readonly conversation: readonly Turn[];
  readonly routes: string;
  readonly spent: Usage;
}

export interface Engine {
  /** Has the model write an app for the description, proves it runs, and deploys it behind sign-in. */
  create(description: string, watch?: Watcher): Promise<AppView>;
  /** Has the model change an app as asked, proves the new version runs, and swaps it in at the same URL. */
  change(name: string, request: string, watch?: Watcher): Promise<AppView>;
  list(): Promise<AppView[]>;
  remove(name: string): Promise<void>;
  /** Who signs in to the apps. Created on first use. */
  owner(): Promise<Owner>;
  /** What the model has spent on every app, including removed ones and attempts that failed. */
  spent(): Promise<Usage>;
}

type Result = { readonly generated: Generated; readonly spent: Usage };

export function createEngine({ store, deployer, identity, model, builder }: Ports): Engine {
  /** Generates an app, counting what the model spends even when it fails. */
  async function generate(ask: Ask, watch: Watcher): Promise<Result> {
    const meter = metered(model);
    try {
      return { generated: await generateApp(ask, { model: meter.model, builder, watch }), spent: meter.spent() };
    } catch (error) {
      const state = await store.load();
      const app = "change" in ask ? findApp(state, ask.app.name) : undefined;
      await store.save(withSpent(app === undefined ? state : withApp(state, charged(app, meter.spent())), meter.spent()));
      throw error;
    }
  }

  async function deploy({ generated, spent }: Result, turns: readonly Turn[], watch: Watcher): Promise<AppView> {
    watch({ kind: "deploying" });
    const state = withOwner(await store.load());
    const app = charged(placeApp(state, generated, turns), spent);
    const next = withSpent(withApp(state, app), spent);
    await identity.sync(next);
    await deployer.deploy(appObjects(app, identity.settingsFor(app)));
    await store.save(next);
    return appView(app);
  }

  return {
    async create(description, watch = UNWATCHED) {
      const taken = (await store.load()).apps.map((app) => app.manifest.name);
      const result = await generate({ description, taken }, watch);
      return deploy(result, [said("person", description), said("mayfly", result.generated.summary || MADE)], watch);
    },

    async change(name, request, watch = UNWATCHED) {
      const app = findApp(await store.load(), name);
      if (app === undefined) throw new Error(`no app named ${name}`);
      const result = await generate({ change: request, app: { name, routes: app.routes } }, watch);
      return deploy(result, [said("person", request), said("mayfly", result.generated.summary || CHANGED)], watch);
    },

    async list() {
      return (await store.load()).apps.map(appView);
    },

    async remove(name) {
      const state = await store.load();
      const app = findApp(state, name);
      if (app === undefined) throw new Error(`no app named ${name}`);
      await deployer.remove(appObjects(app, identity.settingsFor(app)));
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

function withOwner(state: State): State & { readonly owner: Owner } {
  const owner = state.owner ?? { email: "owner@mayfly.local", username: "owner", password: newPassword() };
  return { ...state, owner };
}

/** A changed app keeps its port, secrets and conversation, so its URL and sessions survive. */
function placeApp(state: State, { name, image, routes }: Generated, turns: readonly Turn[]): App {
  const existing = findApp(state, name) ?? {
    hostPort: freePort(state),
    clientSecret: newSecret(),
    cookieSecret: newSecret(),
    conversation: [],
    spent: NO_USAGE,
  };
  return { ...existing, manifest: { name, image }, routes, conversation: [...existing.conversation, ...turns] };
}

function freePort(state: State): number {
  const taken = new Set(state.apps.map((app) => app.hostPort));
  let port = FIRST_PORT;
  while (taken.has(port)) port++;
  return port;
}

function charged(app: App, spent: Usage): App {
  return { ...app, spent: addUsage(app.spent, spent) };
}

function withSpent(state: State, spent: Usage): State {
  return { ...state, spent: addUsage(state.spent, spent) };
}

function said(from: Turn["from"], text: string): Turn {
  return { from, text };
}

function appView(app: App): AppView {
  return { name: app.manifest.name, url: appUrl(app.hostPort), conversation: app.conversation, routes: app.routes, spent: app.spent };
}
