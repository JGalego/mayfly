import { randomBytes } from "node:crypto";
import { appUrl } from "../core/app-url.ts";
import { phoneDoorPort, phoneSidePort } from "../core/phone.ts";
import { appObjects } from "./app-objects.ts";
import { generateApp, listenFor, type Ask, type Attempt, type Generation } from "./generate.ts";
import { ASK_PROMPT, fixFor, questionFor, withFiles } from "./prompt.ts";
import type { Attachment, FileData } from "./attachments.ts";
import { errorsIn } from "./log-errors.ts";
import { mayflyName } from "../core/names.ts";
import { parseAppName } from "../core/manifest.ts";
import { PortTaken, type ContainerHealth, type ModelProvider, type PhoneNetworkStatus, type Ports } from "./ports.ts";
import { newPassword, newSecret } from "./secrets.ts";
import { findApp, findVersion, runningVersion, withApp, withoutApp, type App, type Author, type ModelCall, type Owner, type State, type Turn, type Version } from "./state.ts";
import { UNWATCHED, type Watcher } from "./step.ts";
import { addUsage, metered, NO_USAGE, type Usage } from "./usage.ts";

const FIRST_PORT = 18100;
// Enough to look back a while, which the page's filters then narrow.
const LOG_LINES = 1000;
const CONTAINER = /^[a-z0-9-]+$/;
const EMAIL = /^[^\s@]+@[^\s@]+$/;
// What Mayfly says when the model said nothing after the code.
const MADE = "App deployed.";
const CHANGED = "Update deployed.";
const SAVED = "Saved. Trial passed. Deploy to run this version.";
// How many ports past a taken one sign-in tries before it gives up.
const SIGN_IN_TRIES = 20;
/** What to do before phone access can be turned on, for each way Tailscale isn't ready. */
export function phoneNotReady(status: Exclude<PhoneNetworkStatus, { readonly state: "ready" }>): string {
  switch (status.state) {
    case "missing":
      return "Install Tailscale from tailscale.com/download and sign in, then try again.";
    case "off":
      return "Tailscale is off. Turn it on, then try again.";
    case "signed-out":
      return "Sign in to Tailscale, then try again.";
    case "no-https":
      return "Your tailnet doesn't give this computer HTTPS certificates yet. In Tailscale's admin console, open DNS and choose Enable HTTPS, then try again.";
    case "other-user":
      return `Tailscale is in use by another Windows user (${status.user}). Run Podman Desktop as that user, or sign Tailscale in as this one.`;
    case "failed":
      return `Mayfly couldn't tell how Tailscale is. ${status.reason}`;
  }
}

/** Work that failed, and that the app's conversation already says failed and why. */
export class RecordedFailure extends Error {
  /** The app whose conversation says it, which a new app's failed work leaves behind. */
  readonly app: string;

  constructor(message: string, app: string, options?: ErrorOptions) {
    super(message, options);
    this.app = app;
  }
}

/** A version as a shell shows it: how long its code and the model's thinking are, but not them, which the shell asks for when it needs them. */
export type VersionView = Omit<Version, "routes" | "image" | "thinking"> & { readonly lines: number; readonly thinkingWords: number };

/** What one version's author wrote: its code, and the model's thinking, empty when its provider kept that to itself. */
export interface Written {
  readonly routes: string;
  readonly thinking: string;
}

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
  readonly starred: boolean;
  /** The version running now, or null while no attempt has passed. */
  readonly head: string | null;
  readonly versions: readonly VersionView[];
  readonly conversation: readonly Turn[];
  readonly spent: Usage;
}

export interface Engine {
  /** Has a model write an app for the description, and runs it behind sign-in once an attempt passes. Every attempt is kept. */
  create(description: string, options?: { readonly model?: string | null; readonly watch?: Watcher; readonly files?: readonly FileData[] }): Promise<AppView>;
  /** Has the app's model change it as asked. An attempt that passes replaces the running one at the same URL. Every attempt is kept. */
  change(name: string, request: string, watch?: Watcher, files?: readonly FileData[]): Promise<AppView>;
  /** Has the app's model fix what makes the app log errors, as a change. Refuses when it logged none. */
  fix(name: string, watch?: Watcher): Promise<AppView>;
  /** Sends the last request the app's model was given to it again, as a change. */
  retry(name: string, watch?: Watcher): Promise<AppView>;
  /** Runs the version that ran before the one running now again. Undoing twice puts back the one undone. */
  undo(name: string, watch?: Watcher): Promise<AppView>;
  /** The apps with a version to run that Podman is not running, as after the Podman machine stopped. */
  stopped(): Promise<string[]>;
  /** Runs the running version again, and the sign-in service, as after Podman stopped them. Nothing about the app changes. */
  start(name: string, watch?: Watcher): Promise<AppView>;
  /** Has the app's model answer a question about it from its code, changing nothing. The exchange joins the conversation. */
  ask(name: string, question: string, watch?: Watcher, files?: readonly FileData[]): Promise<AppView>;
  /** A file the person attached in the app's conversation: its name, type and contents. No other file. */
  attachment(name: string, id: string): Promise<FileData>;
  /** Gives an app a new name and runs it again under it, at the same address. People signed in to it sign in again. */
  rename(name: string, to: string, watch?: Watcher): Promise<AppView>;
  /** Marks an app as a favourite, or no longer. */
  star(name: string, starred: boolean): Promise<void>;
  /** Has another model write the app's changes from now on, or the default one for null. */
  useModel(name: string, model: string | null): Promise<AppView>;
  /** Builds and tries code the person wrote by hand from one of the app's versions, and keeps it as theirs, next to that one. It runs only once they deploy it. The message says what they changed. */
  save(name: string, from: string, routes: string, message: string, watch?: Watcher): Promise<AppView>;
  /** Runs any version that passed, at the same URL. The next change starts from it, so history branches rather than being lost. */
  deploy(name: string, version: string, watch?: Watcher): Promise<AppView>;
  /** The code of one version of an app, and what the model thought writing it. */
  written(name: string, version: string): Promise<Written>;
  list(): Promise<AppView[]>;
  remove(name: string): Promise<void>;
  /** Who signs in to the apps. Created on first use. */
  owner(): Promise<Owner>;
  /** Signs the owner in with another email from now on. */
  changeEmail(email: string): Promise<Owner>;
  /** Gives the owner a new random password, and returns them with it. */
  newPassword(): Promise<Owner>;
  /** What the model has spent on every app, including removed ones and attempts that failed. */
  spent(): Promise<Usage>;
  /** Every call to a model, oldest first, removed apps' included. */
  ledger(): Promise<readonly ModelCall[]>;
  /** How each app that should be running, and the sign-in service, is doing. */
  health(): Promise<ServiceHealth[]>;
  /** The last lines one container of an app's pod, or the sign-in service's, wrote. No other pod's. */
  logs(pod: string, container: string): Promise<string[]>;
  /** The computer's name the phone opens apps on, or null while phone access is off. */
  phoneAccess(): Promise<string | null>;
  /** Lets the phone open the apps over the private network, through a second door each. Refuses, saying what to do, until the network is ready. */
  turnOnPhone(): Promise<string>;
  /** Closes the phone's doors. The apps carry on at their localhost addresses. */
  turnOffPhone(): Promise<void>;
}

export function createEngine({ store, deployer, observer, identity, models, builder, files, phoneNetwork }: Ports): Engine {
  async function generate(ask: Ask, model: ModelProvider, watch: Watcher): Promise<Generated> {
    const meter = metered(model);
    // Each attempt is one call, so a call's outcome is its attempt's. Work cut short leaves its calls' outcomes unknown.
    const callsFor = (app: string | null, attempts: readonly Attempt[] = []): ModelCall[] =>
      meter.spending().map(({ at, took, spent }, index) => {
        const attempt = attempts[index];
        return { at, took, app, provider: model.provider, model: model.name, spent, ...(attempt === undefined ? {} : { passed: attempt.problem === null }) };
      });
    try {
      const generation = await generateApp(ask, { model: meter.model, builder, watch });
      return { ...generation, calls: callsFor(generation.name, generation.attempts) };
    } catch (error) {
      // Cut short by the model's service or by Podman, the calls still cost what the model wrote.
      await store.save(charge(await store.load(), callsFor("change" in ask ? ask.app.name : null)));
      throw error;
    }
  }

  /** Keeps the files a person attached, and says what the conversation keeps of them. */
  async function keep(attached: readonly FileData[]): Promise<Attachment[]> {
    return Promise.all(attached.map(async ({ name, type, data }) => ({ id: await files.put(data), name, type, bytes: data.length })));
  }

  async function loaded(attachments: readonly Attachment[]): Promise<FileData[]> {
    return Promise.all(attachments.map(async ({ id, name, type }) => ({ name, type, data: await files.get(id) })));
  }

  /** Does work on an app. If it fails, the app's conversation keeps what was asked and why it failed, and the failure goes on. */
  async function recording<T>(name: string, request: string, attachments: readonly Attachment[], work: () => Promise<T>): Promise<T> {
    const started = Date.now();
    try {
      return await work();
    } catch (error) {
      if (error instanceof RecordedFailure) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      const state = await store.load();
      const app = findApp(state, name);
      if (app === undefined) throw error;
      const turns: Turn[] = [
        { from: "person", text: request, at: started, ...withAttachments(attachments) },
        { from: "mayfly", text: reason, versions: [], took: Date.now() - started, at: Date.now(), failed: true },
      ];
      await store.save(withApp(state, { ...app, conversation: [...app.conversation, ...turns] }));
      throw new RecordedFailure(reason, name, { cause: error });
    }
  }

  /** Keeps every attempt as a version and the exchange in the conversation, charges the calls, then runs the attempt that passed. */
  async function record(request: string, { name, attempts, calls }: Generated, made: Made, watch: Watcher): Promise<AppView> {
    const state = withOwner(await store.load());
    const app = findApp(state, name) ?? { ...newApp(state, name, made.model), lastRequest: request };
    const versions = chain(attempts, request, made);
    const last = versions.at(-1);
    const passed = last?.problem === null ? last : undefined;
    const running = made.runs ? passed : undefined;
    const reply: Extract<Turn, { from: "mayfly" }> = { from: "mayfly", text: replyFor(app, versions, made.runs), versions: versions.map((version) => version.id), took: Date.now() - made.started, at: Date.now() };
    const next: App = {
      ...app,
      ...(running === undefined || app.head === null ? {} : { previous: app.head }),
      versions: [...app.versions, ...versions],
      head: running?.id ?? app.head,
      conversation: [...app.conversation, { from: "person", text: request, at: made.started, ...withAttachments(made.attachments ?? []) }, reply],
    };
    const nextState = charge(withApp(state, next), calls);
    // Kept before it runs: whatever happens then, the model's work and what it cost stay.
    await store.save(nextState);
    if (running !== undefined) {
      watch({ kind: "deploying" });
      let ready = nextState;
      try {
        ready = await signInAndRun(nextState, next, running.image);
        if (ready !== nextState) await store.save(ready);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        // The version stays the one to run, so Start runs it, and Undo still goes back to the one before.
        const text = [running.summary, `It passed its trial, but didn't start: ${reason} Choose Start to run it once that's fixed.`].filter(Boolean).join("\n\n");
        const kept: App = { ...next, conversation: [...next.conversation.slice(0, -1), { ...reply, text, failed: true }] };
        await store.save(withApp(ready, kept));
        throw new RecordedFailure(reason, name, { cause: error });
      }
    }
    return appView(existingApp(nextState, name));
  }

  /** Changes the owner, and tells the sign-in service when it is running for some app. */
  async function updateOwner(change: (owner: Owner) => Owner): Promise<Owner> {
    const state = withOwner(await store.load());
    const next = { ...state, owner: change(state.owner) };
    await store.save(anyRunning(next) ? await syncSignIn(next) : next);
    return next.owner;
  }

  function signInPortOf(state: State): number {
    return state.signInPort ?? identity.preferredPort;
  }

  /**
   * Sign-in is there for the apps: it runs while any does, and goes with the last, for the phone too.
   * Returns the state, which says where it ended up if it had to move.
   */
  async function syncSignIn(state: State): Promise<State> {
    const port = signInPortOf(state);
    if (!anyRunning(state)) {
      await identity.stop();
      if (state.phoneHost !== null) await phoneNetwork.stop(phoneSidePort(port));
      return state;
    }
    try {
      await identity.sync(state, port);
    } catch (error) {
      if (error instanceof PortTaken && error.port === port) return moveSignIn(state, port);
      throw error;
    }
    if (state.phoneHost !== null) await phoneNetwork.serve(phoneSidePort(port), port);
    return state;
  }

  /** Another program holds sign-in's port: sign-in moves to the next one free, and the running apps follow, since they send people there. */
  async function moveSignIn(state: State, taken: number): Promise<State> {
    for (let port = taken + 1; port <= taken + SIGN_IN_TRIES; port++) {
      const moved = { ...state, signInPort: port };
      try {
        // Tried, not probed: under WSL's mirrored networking, a port free to Windows can still be taken for Podman.
        await identity.sync(moved, port);
      } catch (error) {
        if (error instanceof PortTaken && error.port === port) continue;
        throw error;
      }
      if (moved.phoneHost !== null) {
        await phoneNetwork.stop(phoneSidePort(taken));
        await phoneNetwork.serve(phoneSidePort(port), port);
      }
      await runApps(moved);
      return moved;
    }
    throw new Error(`Ports ${taken} to ${taken + SIGN_IN_TRIES} are all in use, so sign-in can't start. Free one of them, then try again.`);
  }

  /** Runs sign-in and one app, and returns the state, which says where sign-in ended up. */
  async function signInAndRun(state: State, app: App, image: string): Promise<State> {
    const ready = await syncSignIn(state);
    // Moving sign-in ran every app again with it, this one included.
    if (ready === state) await runApp(ready, app, image);
    return ready;
  }

  /** Runs an app's image, and while phone access is on, through its phone door too. */
  async function runApp(state: State, app: App, image: string): Promise<void> {
    await deployer.deploy(appObjects(app, image, identity.settingsFor(app, signInPortOf(state)), state.phoneHost));
    if (state.phoneHost !== null) await phoneNetwork.serve(phoneSidePort(app.hostPort), phoneDoorPort(app.hostPort));
  }

  /** Runs every app that has a version to run again, with or without its phone door as the state says. */
  async function runApps(state: State): Promise<void> {
    for (const app of state.apps) {
      const running = runningVersion(app);
      // Built again, as when starting it, in case its image is gone.
      if (running !== undefined) await runApp(state, app, await builder.build(app.name, running.routes));
    }
  }

  /** Runs sign-in and every app with a version to run again, and returns the state, which says where sign-in ended up. */
  async function runAll(state: State): Promise<State> {
    const ready = await syncSignIn(state);
    // Moving sign-in ran the apps again already.
    if (ready === state) await runApps(ready);
    return ready;
  }

  const engine: Engine = {
    async create(description, { model: chosen = null, watch = UNWATCHED, files: attached = [] } = {}) {
      const started = Date.now();
      const taken = (await store.load()).apps.map((app) => app.name);
      const model = models(chosen);
      const attachments = await keep(attached);
      const generation = await generate({ description, taken, files: attached }, model, watch);
      return record(description, generation, { base: null, by: { kind: "model", name: model.name }, model: chosen, started, runs: true, attachments }, watch);
    },

    async change(name, request, watch = UNWATCHED, attached = []) {
      const started = Date.now();
      const state = await store.load();
      const app = existingApp(state, name);
      const attachments = await keep(attached);
      // Kept before anything can fail, so a request that does can be sent again, with its files.
      await store.save(withApp(state, { ...app, lastRequest: request, lastAttachments: attachments }));
      return recording(name, request, attachments, async () => {
        const base = startingPoint(app);
        const model = models(app.model);
        const generation = await generate({ change: request, app: { name, routes: base?.routes ?? "" }, files: attached }, model, watch);
        return record(request, generation, { base: base?.id ?? null, by: { kind: "model", name: model.name }, model: app.model, started, runs: true, attachments }, watch);
      });
    },

    async fix(name, watch = UNWATCHED) {
      existingApp(await store.load(), name);
      const errors = errorsIn(await observer.logs(mayflyName(name), "app", LOG_LINES));
      if (errors.length === 0) throw new Error(`${name} logged no errors to fix.`);
      return engine.change(name, fixFor(errors), watch);
    },

    async retry(name, watch = UNWATCHED) {
      const app = existingApp(await store.load(), name);
      // Apps kept before the last request was remembered have their model's last version's.
      const request = app.lastRequest ?? app.versions.findLast((version) => version.by.kind === "model")?.request;
      if (request === undefined) throw new Error(`${name} has no request to retry.`);
      return engine.change(name, request, watch, await loaded(app.lastAttachments ?? []));
    },

    async undo(name, watch = UNWATCHED) {
      const { previous } = existingApp(await store.load(), name);
      if (previous === undefined) throw new Error(`${name} has no previous deployment.`);
      return engine.deploy(name, previous, watch);
    },

    async stopped() {
      const services = await engine.health();
      return services.filter((service) => service.kind === "app" && !runs(service)).map((service) => service.name);
    },

    async start(name, watch = UNWATCHED) {
      return recording(name, "Start the app", [], async () => {
        const state = withOwner(await store.load());
        const app = existingApp(state, name);
        const running = runningVersion(app);
        if (running === undefined) throw new Error(`${name} has no deployed version to start.`);
        // Built again, as when deploying, in case its image is gone; it passed its trial when it was made.
        watch({ kind: "building" });
        const image = await builder.build(name, running.routes);
        watch({ kind: "deploying" });
        const ready = await signInAndRun(state, app, image);
        if (ready !== state) await store.save(ready);
        return appView(app);
      });
    },

    async ask(name, question, watch = UNWATCHED, attached = []) {
      const attachments = await keep(attached);
      return recording(name, question, attachments, async () => {
        const started = Date.now();
        const app = existingApp(await store.load(), name);
        const model = models(app.model);
        const meter = metered(model);
        const { text } = await meter.model.complete(ASK_PROMPT, [{ role: "user", content: withFiles(questionFor({ name, routes: startingPoint(app)?.routes ?? "" }, question), attached) }], listenFor(watch));
        const calls = meter.spending().map(({ at, took, spent }): ModelCall => ({ at, took, app: name, provider: model.provider, model: model.name, spent, question: true }));
        // Loaded again, as anything else that changed while the model answered stays.
        const state = await store.load();
        const now = existingApp(state, name);
        const turns: Turn[] = [
          { from: "person", text: question, at: started, ...withAttachments(attachments) },
          { from: "mayfly", text: text.trim(), versions: [], took: Date.now() - started, at: Date.now() },
        ];
        const next = charge(withApp(state, { ...now, conversation: [...now.conversation, ...turns] }), calls);
        await store.save(next);
        return appView(existingApp(next, name));
      });
    },

    async rename(name, to, watch = UNWATCHED) {
      return recording(name, `Rename to \`${to}\``, [], async () => {
        const started = Date.now();
        const state = await store.load();
        const app = existingApp(state, name);
        const newName = usableName(state, name, to);
        // Names go in backticks, which shells show as names rather than words.
        const note = `Renamed \`${name}\` to \`${newName}\`. The address is unchanged. Sign in again to use the app.`;
        const conversation: Turn[] = [...app.conversation, { from: "person", text: `Rename to \`${newName}\``, at: started }, { from: "mayfly", text: note, versions: [], took: Date.now() - started, at: Date.now() }];
        const renamed: App = { ...app, name: newName, conversation };
        const next: State = {
          ...state,
          apps: state.apps.map((kept) => (kept.name === name ? renamed : kept)),
          calls: state.calls.map((call) => (call.app === name ? { ...call, app: newName } : call)),
        };
        const running = runningVersion(app);
        // The pod, the sign-in client and its cookie all carry the name, so the app stops under the old one and starts under the new.
        let ready = next;
        if (running !== undefined) {
          watch({ kind: "building" });
          const image = await builder.build(newName, running.routes);
          watch({ kind: "deploying" });
          await deployer.remove(appObjects(app, running.image, identity.settingsFor(app, signInPortOf(state))));
          ready = await signInAndRun(next, renamed, image);
        } else ready = await syncSignIn(next);
        await builder.forget(name);
        await store.save(ready);
        return appView(renamed);
      });
    },

    async star(name, starred) {
      const state = await store.load();
      await store.save(withApp(state, { ...existingApp(state, name), starred }));
    },

    async useModel(name, model) {
      const state = await store.load();
      const app = existingApp(state, name);
      const label = models(model).name;
      const now = Date.now();
      const conversation: Turn[] = [
        { from: "person", text: `Use ${label} for this app`, at: now },
        { from: "mayfly", text: `Model set to ${label}.`, versions: [], took: 0, at: now },
      ];
      const next: App = { ...app, model, conversation: [...app.conversation, ...conversation] };
      await store.save(withApp(state, next));
      return appView(next);
    },

    async save(name, from, routes, message, watch = UNWATCHED) {
      return recording(name, message || "Manual edit", [], async () => {
        const started = Date.now();
        const state = withOwner(await store.load());
        if (findVersion(existingApp(state, name), from) === undefined) throw new Error(`${name} has no version ${from}`);
        watch({ kind: "building" });
        const image = await builder.build(name, routes);
        watch({ kind: "trying" });
        const trial = await builder.trial(image);
        if (!trial.ok) watch({ kind: "failed", problem: trial.problem });
        const outcome = trial.ok ? { problem: null, image } : { problem: trial.problem, image: null };
        const attempt: Attempt = { routes, summary: "", spent: NO_USAGE, at: Date.now(), ...outcome };
        const by: Author = { kind: "person", name: state.owner.email };
        return record(message || "Manual edit", { name, attempts: [attempt], calls: [] }, { base: from, by, model: null, started, runs: false }, watch);
      });
    },

    async deploy(name, id, watch = UNWATCHED) {
      return recording(name, `Deploy version \`${id}\``, [], async () => {
        const started = Date.now();
        const state = withOwner(await store.load());
        const app = existingApp(state, name);
        const version = findVersion(app, id);
        if (version?.problem !== null) throw new Error(`${name} has no version ${id} that passed`);
        // It passed its trial when it was made, on the same runtime, so it is built again but not tried again.
        watch({ kind: "building" });
        const image = await builder.build(name, version.routes);
        // Versions go in backticks, like app names, so shells set them apart.
        const note = `Deployed version \`${id}\`: “${version.request}”.`;
        const conversation: Turn[] = [
          { from: "person", text: `Deploy version \`${id}\``, at: started },
          { from: "mayfly", text: note, versions: [], took: Date.now() - started, at: Date.now() },
        ];
        const next: App = { ...app, ...(app.head === null || app.head === id ? {} : { previous: app.head }), head: id, conversation: [...app.conversation, ...conversation] };
        const nextState = withApp(state, next);
        watch({ kind: "deploying" });
        await store.save(await signInAndRun(nextState, next, image));
        return appView(next);
      });
    },

    async attachment(name, id) {
      const app = existingApp(await store.load(), name);
      const found = app.conversation.flatMap((turn) => (turn.from === "person" ? (turn.attachments ?? []) : [])).find((file) => file.id === id);
      if (found === undefined) throw new Error(`${name} has no file ${id}`);
      return { name: found.name, type: found.type, data: await files.get(id) };
    },

    async written(name, id) {
      const version = findVersion(existingApp(await store.load(), name), id);
      if (version === undefined) throw new Error(`${name} has no version ${id}`);
      return { routes: version.routes, thinking: version.thinking ?? "" };
    },

    async list() {
      return (await store.load()).apps.map(appView);
    },

    async remove(name) {
      const state = await store.load();
      const app = existingApp(state, name);
      const running = runningVersion(app);
      if (running !== undefined) {
        await deployer.remove(appObjects(app, running.image, identity.settingsFor(app, signInPortOf(state))));
        if (state.phoneHost !== null) await phoneNetwork.stop(phoneSidePort(app.hostPort));
      }
      await builder.forget(name);
      await store.save(await syncSignIn(withoutApp(state, name)));
    },

    async phoneAccess() {
      return (await store.load()).phoneHost;
    },

    async turnOnPhone() {
      const network = await phoneNetwork.status();
      if (network.state !== "ready") throw new Error(phoneNotReady(network));
      const next = { ...(await store.load()), phoneHost: network.host };
      // Saved first: if serving fails partway, it's on, and turning it off or on again puts everything right.
      await store.save(next);
      const ready = await runAll(next);
      if (ready !== next) await store.save(ready);
      return network.host;
    },

    async turnOffPhone() {
      const state = await store.load();
      if (state.phoneHost === null) return;
      // Stopped first: if that fails partway, it's still on, for another try.
      for (const app of state.apps) if (app.head !== null) await phoneNetwork.stop(phoneSidePort(app.hostPort));
      await phoneNetwork.stop(phoneSidePort(signInPortOf(state)));
      const next = { ...state, phoneHost: null };
      await store.save(next);
      const ready = await runAll(next);
      if (ready !== next) await store.save(ready);
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

    async ledger() {
      return (await store.load()).calls;
    },

    async changeEmail(email) {
      const address = email.trim();
      if (!EMAIL.test(address)) throw new Error("Enter a valid email address.");
      return updateOwner((owner) => ({ ...owner, email: address, username: address.split("@")[0] ?? address }));
    },

    async newPassword() {
      return updateOwner((owner) => ({ ...owner, password: newPassword() }));
    },

    async health() {
      const running = (await store.load()).apps.filter((app) => app.head !== null);
      const services: Omit<ServiceHealth, "containers">[] = [
        ...running.map((app) => ({ name: app.name, kind: "app" as const, pod: mayflyName(app.name) })),
        ...(running.length > 0 ? [{ name: "Sign-in", kind: "sign-in" as const, pod: identity.pod }] : []),
      ];
      const pods = await observer.health(services.map((service) => service.pod));
      return services.map((service) => ({ ...service, containers: pods.find((pod) => pod.pod === service.pod)?.containers ?? [] }));
    },

    async logs(pod, container) {
      const ours = [...(await store.load()).apps.map((app) => mayflyName(app.name)), identity.pod];
      if (!ours.includes(pod) || !CONTAINER.test(container)) throw new Error(`Mayfly does not read the logs of ${pod}`);
      return observer.logs(pod, container, LOG_LINES);
    },
  };
  return engine;
}

/** Whether any app has a version deployed. */
function anyRunning(state: State): boolean {
  return state.apps.some((app) => app.head !== null);
}

/** A generation, and the calls to the model it took. */
type Generated = Generation & { readonly calls: readonly ModelCall[] };

/** Who made a request's versions, what they started from, and when; and for a new app, the model it was made with. */
interface Made {
  readonly base: string | null;
  readonly by: Author;
  readonly model: string | null;
  readonly started: number;
  /** Whether an attempt that passes replaces the running version, or is only kept. */
  readonly runs: boolean;
  /** The files the person attached to the request. */
  readonly attachments?: readonly Attachment[];
}

/** Where a change starts: the running code, or for an app that never ran, its latest attempt that had any. */
function startingPoint(app: App): Version | undefined {
  return runningVersion(app) ?? app.versions.findLast((version) => version.routes !== "");
}

/** A turn's attachments, when it has any. */
function withAttachments(attachments: readonly Attachment[]): { readonly attachments?: readonly Attachment[] } {
  return attachments.length === 0 ? {} : { attachments };
}

/** Whether every container of a pod runs. A pod with none does not. */
function runs({ containers }: ServiceHealth): boolean {
  return containers.length > 0 && containers.every((container) => container.state === "running");
}

/** A name another app does not have, and that the contract allows. */
function usableName(state: State, name: string, to: string): string {
  if (to === name) throw new Error(`${name} is already called that.`);
  if (findApp(state, to) !== undefined) throw new Error(`There is already an app called ${to}.`);
  try {
    return parseAppName(to);
  } catch {
    throw new Error(`${to} can't be an app's name: use lowercase letters, digits and inner hyphens, at most 40 characters.`);
  }
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
  return { name, ...port, model, starred: false, versions: [], head: null, conversation: [], spent: NO_USAGE };
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

function replyFor(app: App, versions: readonly Version[], runs: boolean): string {
  const last = versions.at(-1);
  if (last?.problem === null && !runs) return SAVED;
  if (last?.problem === null) return last.summary || (app.head === null ? MADE : CHANGED);
  const unchanged = app.head === null ? "" : " Previous deployment unchanged.";
  const failed = versions.length === 1 ? "Trial failed." : `All ${versions.length} attempts failed.`;
  return `${failed}${unchanged} ${versions.length === 1 ? "Error" : "Last error"}:\n\n${last?.problem ?? ""}`;
}

/** Enters the calls in the ledger, and counts what each spent against the total and its app. */
function charge(state: State, calls: readonly ModelCall[]): State {
  return calls.reduce((charged, call) => {
    const app = call.app === null ? undefined : findApp(charged, call.app);
    const counted = app === undefined ? charged : withApp(charged, { ...app, spent: addUsage(app.spent, call.spent) });
    return { ...counted, spent: addUsage(counted.spent, call.spent), calls: [...counted.calls, call] };
  }, state);
}

function appView(app: App): AppView {
  const versions = app.versions.map(({ routes, image: _image, thinking = "", ...view }) => ({
    ...view,
    lines: routes.split("\n").length - 1,
    thinkingWords: thinking.split(/\s+/).filter(Boolean).length,
  }));
  return { name: app.name, url: appUrl(app.hostPort), model: app.model, starred: app.starred, head: app.head, versions, conversation: app.conversation, spent: app.spent };
}
