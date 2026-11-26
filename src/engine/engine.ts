import { randomBytes } from "node:crypto";
import { appUrl } from "../core/app-url.ts";
import { appObjects } from "./app-objects.ts";
import { generateApp, type Ask, type Attempt, type Generation } from "./generate.ts";
import { mayflyName } from "../core/names.ts";
import type { ContainerHealth, ModelProvider, Ports } from "./ports.ts";
import { newPassword, newSecret } from "./secrets.ts";
import { findApp, findVersion, runningVersion, withApp, withoutApp, type App, type Author, type Owner, type State, type Turn, type Version } from "./state.ts";
import { UNWATCHED, type Watcher } from "./step.ts";
import { addUsage, metered, NO_USAGE, type Usage } from "./usage.ts";

const FIRST_PORT = 18100;
// What Mayfly says when the model said nothing after the code.
const MADE = "Your app is ready.";
const CHANGED = "Done. Your app has the change.";

/** A version as a shell shows it: how long its code is, but not the code, which the shell asks for when it needs it. */
export type VersionView = Omit<Version, "routes" | "image"> & { readonly lines: number };

/** How an app's pod, or the sign-in service's, is doing. No containers means it is not running. */
export interface ServiceHealth {
  readonly name: string;
  readonly kind: "app" | "sign-in";
  readonly pod: string;
  readonly containers: readonly ContainerHealth[];
}

/** What a shell shows of an app. Never its secrets. */
export interface AppView {
  readonly name: string;
  readonly url: string;
  /** The model that writes its changes, or null for the default one. */
  readonly model: string | null;
  /** The version running now, or null while no attempt has passed. */
  readonly head: string | null;
  readonly versions: readonly VersionView[];
  readonly conversation: readonly Turn[];
  readonly spent: Usage;
}

export interface Engine {
  /** Has a model write an app for the description, and runs it behind sign-in once an attempt passes. Every attempt is kept. */
  create(description: string, options?: { readonly model?: string | null; readonly watch?: Watcher }): Promise<AppView>;
  /** Has the app's model change it as asked. An attempt that passes replaces the running one at the same URL. Every attempt is kept. */
  change(name: string, request: string, watch?: Watcher): Promise<AppView>;
  /** Has another model write the app's changes from now on, or the default one for null. */
  useModel(name: string, model: string | null): Promise<AppView>;
  /** Builds, tries and runs code the person wrote by hand, kept as a version of theirs. The message says what they changed. */
  edit(name: string, routes: string, message: string, watch?: Watcher): Promise<AppView>;
  /** Runs an earlier version that passed again, at the same URL. The next change starts from it, so history branches rather than being lost. */
  restore(name: string, version: string, watch?: Watcher): Promise<AppView>;
  /** The code of one version of an app. */
  code(name: string, version: string): Promise<string>;
  list(): Promise<AppView[]>;
  remove(name: string): Promise<void>;
  /** Who signs in to the apps. Created on first use. */
  owner(): Promise<Owner>;
  /** What the model has spent on every app, including removed ones and attempts that failed. */
  spent(): Promise<Usage>;
  /** How each app that should be running, and the sign-in service, is doing. */
  health(): Promise<ServiceHealth[]>;
}

export function createEngine({ store, deployer, observer, identity, models, builder }: Ports): Engine {
  async function generate(ask: Ask, model: ModelProvider, watch: Watcher): Promise<Generation> {
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
  async function record(request: string, { name, attempts }: Generation, made: Made, watch: Watcher): Promise<AppView> {
    const state = withOwner(await store.load());
    const app = findApp(state, name) ?? newApp(state, name, made.model);
    const versions = chain(attempts, request, made);
    const last = versions.at(-1);
    const passed = last?.problem === null ? last : undefined;
    const spent = attempts.reduce((sum, attempt) => addUsage(sum, attempt.spent), NO_USAGE);
    const reply: Turn = { from: "mayfly", text: replyFor(app, versions), versions: versions.map((version) => version.id), took: Date.now() - made.started, at: Date.now() };
    const next: App = {
      ...app,
      versions: [...app.versions, ...versions],
      head: passed?.id ?? app.head,
      conversation: [...app.conversation, { from: "person", text: request, at: made.started }, reply],
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
    async create(description, { model: chosen = null, watch = UNWATCHED } = {}) {
      const started = Date.now();
      const taken = (await store.load()).apps.map((app) => app.name);
      const model = models(chosen);
      const generation = await generate({ description, taken }, model, watch);
      return record(description, generation, { base: null, by: { kind: "model", name: model.name }, model: chosen, started }, watch);
    },

    async change(name, request, watch = UNWATCHED) {
      const started = Date.now();
      const app = existingApp(await store.load(), name);
      const base = startingPoint(app);
      const model = models(app.model);
      const generation = await generate({ change: request, app: { name, routes: base?.routes ?? "" } }, model, watch);
      return record(request, generation, { base: base?.id ?? null, by: { kind: "model", name: model.name }, model: app.model, started }, watch);
    },

    async useModel(name, model) {
      const state = await store.load();
      const app = existingApp(state, name);
      const label = models(model).name;
      const now = Date.now();
      const conversation: Turn[] = [
        { from: "person", text: `Use ${label} for this app`, at: now },
        { from: "mayfly", text: `From now on, ${label} writes the changes to this app.`, versions: [], took: 0, at: now },
      ];
      const next: App = { ...app, model, conversation: [...app.conversation, ...conversation] };
      await store.save(withApp(state, next));
      return appView(next);
    },

    async edit(name, routes, message, watch = UNWATCHED) {
      const started = Date.now();
      const state = withOwner(await store.load());
      const base = startingPoint(existingApp(state, name));
      watch({ kind: "building" });
      const image = await builder.build(name, routes);
      watch({ kind: "trying" });
      const trial = await builder.trial(image);
      if (!trial.ok) watch({ kind: "failed", problem: trial.problem });
      const outcome = trial.ok ? { problem: null, image } : { problem: trial.problem, image: null };
      const attempt: Attempt = { routes, summary: trial.ok ? "Your edit is running." : "", spent: NO_USAGE, at: Date.now(), ...outcome };
      return record(message || "Edit the code by hand", { name, attempts: [attempt] }, { base: base?.id ?? null, by: { kind: "person", name: state.owner.email }, model: null, started }, watch);
    },

    async restore(name, id, watch = UNWATCHED) {
      const started = Date.now();
      const state = withOwner(await store.load());
      const app = existingApp(state, name);
      const version = findVersion(app, id);
      if (version?.problem !== null) throw new Error(`${name} has no version ${id} that passed`);
      // It passed its trial when it was made, on the same runtime, so it is built again but not tried again.
      watch({ kind: "building" });
      const image = await builder.build(name, version.routes);
      const note = `Back to the version made for “${version.request}”. Ask for a change to carry on from here.`;
      const conversation: Turn[] = [
        { from: "person", text: `Go back to version ${id}`, at: started },
        { from: "mayfly", text: note, versions: [], took: Date.now() - started, at: Date.now() },
      ];
      const next: App = { ...app, head: id, conversation: [...app.conversation, ...conversation] };
      const nextState = withApp(state, next);
      watch({ kind: "deploying" });
      await identity.sync(nextState);
      await deployer.deploy(appObjects(next, image, identity.settingsFor(next)));
      await store.save(nextState);
      return appView(next);
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

    async health() {
      const running = (await store.load()).apps.filter((app) => app.head !== null);
      const services: Omit<ServiceHealth, "containers">[] = [
        ...running.map((app) => ({ name: app.name, kind: "app" as const, pod: mayflyName(app.name) })),
        { name: "Sign-in", kind: "sign-in", pod: identity.pod },
      ];
      const pods = await observer.health(services.map((service) => service.pod));
      return services.map((service) => ({ ...service, containers: pods.find((pod) => pod.pod === service.pod)?.containers ?? [] }));
    },
  };
}

/** Who made a request's versions, what they started from, and when; and for a new app, the model it was made with. */
interface Made {
  readonly base: string | null;
  readonly by: Author;
  readonly model: string | null;
  readonly started: number;
}

/** Where a change starts: the running code, or for an app that never ran, its latest attempt that had any. */
function startingPoint(app: App): Version | undefined {
  return runningVersion(app) ?? app.versions.findLast((version) => version.routes !== "");
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
function newApp(state: State, name: string, model: string | null): App {
  const port = { hostPort: freePort(state), clientSecret: newSecret(), cookieSecret: newSecret() };
  return { name, ...port, model, versions: [], head: null, conversation: [], spent: NO_USAGE };
}

function freePort(state: State): number {
  const taken = new Set(state.apps.map((app) => app.hostPort));
  let port = FIRST_PORT;
  while (taken.has(port)) port++;
  return port;
}

/** The attempts as versions, each starting from the one before, and the first from the base. */
function chain(attempts: readonly Attempt[], request: string, { base, by }: Made): Version[] {
  const versions: Version[] = [];
  for (const [index, attempt] of attempts.entries()) {
    versions.push({ id: randomBytes(4).toString("hex"), parent: versions.at(-1)?.id ?? base, request, by, attempt: index + 1, ...attempt });
  }
  return versions;
}

function replyFor(app: App, versions: readonly Version[]): string {
  const last = versions.at(-1);
  if (last?.problem === null) return last.summary || (app.head === null ? MADE : CHANGED);
  const unchanged = app.head === null ? "" : " Your app is as it was.";
  const failed = versions.length === 1 ? "It didn't pass its trial." : `It still failed after ${versions.length} attempts.`;
  return `${failed}${unchanged} The ${versions.length === 1 ? "" : "last "}problem was:\n\n${last?.problem ?? ""}`;
}

/** Counts tokens against the total and, when it names one, against an app. */
function spend(state: State, spent: Usage, name?: string): State {
  const app = name === undefined ? undefined : findApp(state, name);
  const charged = app === undefined ? state : withApp(state, { ...app, spent: addUsage(app.spent, spent) });
  return { ...charged, spent: addUsage(state.spent, spent) };
}

function appView(app: App): AppView {
  const versions = app.versions.map(({ routes, image: _image, ...view }) => ({ ...view, lines: routes.split("\n").length - 1 }));
  return { name: app.name, url: appUrl(app.hostPort), model: app.model, head: app.head, versions, conversation: app.conversation, spent: app.spent };
}
