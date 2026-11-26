import type { AppView, Engine } from "../../engine/engine.ts";
import type { Step, Watcher } from "../../engine/step.ts";
import type { Check } from "./doctor.ts";
import type { Activity, FromUi, Progress, ToUi, Work } from "./messages.ts";
import { makeDefault, modelViews, readModel, removeModel, saveModel } from "./model-settings.ts";
import type { Models, ModelSetting } from "./settings.ts";

const MAX_REQUEST = 2000;
// Far more than any app Mayfly writes, and a bound on what the page can make the extension build.
const MAX_ROUTES = 200_000;
const MAX_MESSAGE = 200;
const BUSY = "Mayfly is still working on your last request. Wait for it to finish.";
// The model's draft changes many times a second. The page gets the latest at most this often.
const DRAFT_MS = 150;
// Enough to see the last few hours of work, and small enough to keep in memory.
const ACTIVITY = 200;
const DONE: Record<Exclude<Progress["kind"], "remove">, string> = { create: "Made", change: "Changed", restore: "Went back on", edit: "Tried a hand edit on" };

export interface ControllerPorts {
  readonly engine: Engine;
  readonly post: (message: ToUi) => Promise<unknown>;
  readonly openExternal: (url: string) => Promise<unknown>;
  readonly copy: (text: string) => Promise<unknown>;
  readonly settings: {
    models(): Models;
    saveModels(models: Models): Promise<void>;
    /** Whether the person works with the code too: versions, history, the editor, health and logs. */
    developer(): boolean;
    saveDeveloper(on: boolean): Promise<void>;
  };
  /** Checks that Mayfly has everything it needs. */
  readonly doctor: () => Promise<readonly Check[]>;
  /** API keys, each kept for the endpoint it was given for. */
  readonly keys: { has(endpoint: string): Promise<boolean>; save(endpoint: string, key: string): Promise<void> };
}

// One request at a time: each one reads and writes the whole state.
type Session = ControllerPorts & { working: Progress | null; draftDue: boolean; activity: Activity[] };

/** Handles what the page asks for. The page is trusted with nothing: it names apps, never URLs, and never sees a secret. */
export function createController(ports: ControllerPorts): (message: unknown) => Promise<void> {
  const session: Session = { ...ports, working: null, draftDue: false, activity: [] };
  return async (message) => {
    const request = readRequest(message);
    if (request === undefined) return;
    try {
      await handle(request, session);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      note(session, "error", text);
      await ports.post({ type: "error", text });
      await showState(session);
    }
  };
}

async function handle(request: FromUi, session: Session): Promise<unknown> {
  switch (request.type) {
    case "ready":
      return showState(session);
    case "send":
      return send({ ...request, request: request.request.trim() }, session);
    case "open":
      return open(request.name, session);
    case "sign-out":
      return open(request.name, session, "oauth2/sign_out");
    case "remove":
      return remove(request.name, session);
    case "copy":
      return copySignIn(request.what, session);
    case "save-model":
      return settle(saveModel(request.model, request.apiKey.trim(), session), session, "Saved.");
    case "remove-model":
      return settle(removeModel(request.id, session), session);
    case "default-model":
      return settle(makeDefault(request.id, session), session);
    case "use-model":
      return useModel(request.app, request.model, session);
    case "star":
      await session.engine.star(request.app, request.starred);
      return showState(session);
    case "owner-email":
      await session.engine.changeEmail(request.email);
      await session.post({ type: "notice", text: "Your apps now sign you in with this email." });
      return showState(session);
    case "new-password":
      // Straight to the clipboard: like the old one, the new password never goes to the page.
      await session.copy((await session.engine.newPassword()).password);
      return session.post({ type: "notice", text: "New password made and copied. Paste it when your app asks you to sign in." });
    case "developer":
      return saveDeveloper(request.on, session);
    case "code":
      return sendCode(request.app, request.version, session);
    case "health":
      return session.post({ type: "health", services: await session.engine.health() });
    case "activity":
      return session.post({ type: "activity", entries: session.activity });
    case "doctor":
      return session.post({ type: "doctor", checks: await session.doctor() });
    case "logs":
      return session.post({ type: "logs", pod: request.pod, container: request.container, lines: await session.engine.logs(request.pod, request.container) });
    case "restore":
      return restore(request.app, request.version, session);
    case "edit":
      return editByHand(request.app, request.routes, request.message.trim(), session);
  }
}

async function send(work: Work, session: Session): Promise<void> {
  const problem = problemWithWork(work, session);
  if (problem !== undefined) return void (await session.post({ type: "error", text: problem }));
  const { engine } = session;
  const kind = work.app === null ? "create" : "change";
  const model = work.model ?? session.settings.models().default;
  const job = (watch: Watcher): Promise<AppView> => (work.app === null ? engine.create(work.request, { model, watch }) : engine.change(work.app, work.request, watch));
  const app = await run({ ...work, kind }, session, job);
  if (work.app !== null) return;
  await session.post({ type: "created", name: app.name });
  if (app.head !== null) await session.openExternal(app.url);
}

async function useModel(app: string, model: string, session: Session): Promise<void> {
  if (session.working !== null) return void (await session.post({ type: "error", text: BUSY }));
  if (!session.settings.models().models.some((setting) => setting.id === model)) return;
  await session.engine.useModel(app, model);
  note(session, "info", `Switched ${app} to another model`);
  await showState(session);
}

/** Shows the outcome of a settings change: what is wrong with it, or the new state. */
async function settle(change: Promise<string | undefined | void>, session: Session, done?: string): Promise<void> {
  const problem = await change;
  if (typeof problem === "string") return void (await session.post({ type: "error", text: problem }));
  if (done !== undefined) await session.post({ type: "notice", text: done });
  await showState(session);
}

async function restore(app: string, version: string, session: Session): Promise<void> {
  if (session.working !== null) return void (await session.post({ type: "error", text: BUSY }));
  await run({ app, request: `Go back to version ${version}`, kind: "restore" }, session, (watch) => session.engine.restore(app, version, watch));
}

async function editByHand(app: string, routes: string, message: string, session: Session): Promise<void> {
  const problem = problemWithEdit(routes, message, session);
  if (problem !== undefined) return void (await session.post({ type: "error", text: problem }));
  await run({ app, request: message || "Edit the code by hand", kind: "edit" }, session, (watch) => session.engine.edit(app, routes, message, watch));
}

function problemWithEdit(routes: string, message: string, session: Session): string | undefined {
  if (session.working !== null) return BUSY;
  if (routes.trim() === "") return "The code is empty.";
  if (routes.length > MAX_ROUTES) return "That is too much code for one app.";
  if (message.length > MAX_MESSAGE) return `Keep the message under ${MAX_MESSAGE} characters.`;
  return undefined;
}

/** Keeps something Mayfly did in its activity log, dropping the oldest once it is full. */
function note(session: Session, level: Activity["level"], text: string): void {
  session.activity = [...session.activity, { at: Date.now(), level, text }].slice(-ACTIVITY);
}

/** Does one piece of work, showing its progress while it runs. */
async function run(work: Omit<Progress, "since" | "steps"> & { kind: keyof typeof DONE }, session: Session, job: (watch: Watcher) => Promise<AppView>): Promise<AppView> {
  session.working = { ...work, since: Date.now(), steps: [] };
  note(session, "info", `Started: ${work.request}`);
  await showState(session);
  const app = await job((step) => showProgress(step, session)).finally(() => {
    session.working = null;
  });
  // Going back runs a version that passed; anything else passed if its last attempt did.
  const last = app.versions.at(-1);
  const passed = work.kind === "restore" || last === undefined || last.problem === null;
  note(session, passed ? "info" : "error", `${DONE[work.kind]} ${app.name}${passed ? "" : ", but it did not pass its trial"}`);
  await showState(session);
  return app;
}

function showProgress(step: Step, session: Session): void {
  if (session.working === null) return;
  session.working = { ...session.working, steps: withStep(session.working.steps, step) };
  if (step.kind !== "draft") return postProgress(session);
  // Only a developer sees the draft, and a few times a second rather than on every word.
  if (session.draftDue || !session.settings.developer()) return;
  session.draftDue = true;
  setTimeout(() => {
    session.draftDue = false;
    postProgress(session);
  }, DRAFT_MS);
}

/** A draft replaces the draft before it, and whatever comes next replaces the last draft. */
function withStep(steps: readonly Step[], step: Step): readonly Step[] {
  return steps.at(-1)?.kind === "draft" ? [...steps.slice(0, -1), step] : [...steps, step];
}

function postProgress(session: Session): void {
  if (session.working === null) return;
  // The page may have closed. When it opens again, the state it asks for brings it up to date.
  session.post({ type: "progress", working: session.working }).catch(() => undefined);
}

function problemWithWork(work: Work, session: Session): string | undefined {
  if (session.working !== null) return BUSY;
  if (work.request === "") return "Say what you need first.";
  if (work.request.length > MAX_REQUEST) return `Keep it under ${MAX_REQUEST} characters.`;
  return undefined;
}

/** Opens an app, or a page of its auth proxy's, at the URL the engine knows. */
async function open(name: string, session: Session, path = ""): Promise<void> {
  const app = (await session.engine.list()).find((candidate) => candidate.name === name);
  if (app !== undefined) await session.openExternal(new URL(path, app.url).toString());
}

// Removing takes a moment, and while it does the page shows it and leaves the app alone.
async function remove(name: string, session: Session): Promise<void> {
  if (session.working !== null) return void (await session.post({ type: "error", text: BUSY }));
  session.working = { app: name, request: `Remove ${name}`, kind: "remove", since: Date.now(), steps: [] };
  await showState(session);
  await session.engine.remove(name).finally(() => {
    session.working = null;
  });
  note(session, "info", `Removed ${name}`);
  await showState(session);
}

// The page shows that it copied. The password itself never goes to the page.
async function copySignIn(what: "email" | "password", session: Session): Promise<void> {
  await session.copy((await session.engine.owner())[what]);
}

async function sendCode(app: string, version: string, session: Session): Promise<void> {
  await session.post({ type: "code", app, version, routes: await session.engine.code(app, version) });
}

async function saveDeveloper(on: boolean, session: Session): Promise<void> {
  await session.settings.saveDeveloper(on);
  await showState(session);
}

async function showState(session: Session): Promise<void> {
  await session.post({
    type: "state",
    apps: await session.engine.list(),
    owner: (await session.engine.owner()).email,
    models: await modelViews(session),
    defaultModel: session.settings.models().default,
    spent: await session.engine.spent(),
    working: session.working,
    developer: session.settings.developer(),
  });
}

// Messages come from the page, so each is checked for its shape before anything acts on it.
function readRequest(message: unknown): FromUi | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const { type, app, request, name, apiKey, on, version, what, routes, message: words, model, id, pod, container, starred, email } = message as Record<string, unknown>;
  switch (type) {
    case "ready":
    case "new-password":
    case "health":
    case "doctor":
    case "activity":
      return { type };
    case "logs":
      return typeof pod === "string" && typeof container === "string" ? { type, pod, container } : undefined;
    case "copy":
      return what === "email" || what === "password" ? { type, what } : undefined;
    case "send": {
      const valid = (typeof app === "string" || app === null) && typeof request === "string" && (model === undefined || typeof model === "string");
      return valid ? { type, app, request, ...(model === undefined ? {} : { model }) } : undefined;
    }
    case "use-model":
      return typeof app === "string" && typeof model === "string" ? { type, app, model } : undefined;
    case "star":
      return typeof app === "string" && typeof starred === "boolean" ? { type, app, starred } : undefined;
    case "owner-email":
      return typeof email === "string" ? { type, email } : undefined;
    case "remove-model":
    case "default-model":
      return typeof id === "string" ? { type, id } : undefined;
    case "open":
    case "sign-out":
    case "remove":
      return typeof name === "string" ? { type, name } : undefined;
    case "developer":
      return typeof on === "boolean" ? { type, on } : undefined;
    case "edit":
      return typeof app === "string" && typeof routes === "string" && typeof words === "string" ? { type, app, routes, message: words } : undefined;
    case "code":
    case "restore":
      return typeof app === "string" && typeof version === "string" ? { type, app, version } : undefined;
    case "save-model": {
      const setting: ModelSetting | undefined = readModel(model);
      return setting !== undefined && typeof apiKey === "string" ? { type, model: setting, apiKey } : undefined;
    }
    default:
      return undefined;
  }
}
