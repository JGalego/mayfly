import { RecordedFailure, type AppView, type Engine } from "../../engine/engine.ts";
import type { Step, Watcher } from "../../engine/step.ts";
import { problemWithFiles, type FileData } from "../../engine/attachments.ts";
import { onPhone } from "../../core/phone.ts";
import type { Examination } from "./doctor.ts";
import { mailto, newPasswordMail, sharedMail, welcomeMail, type Mail } from "./invitations.ts";
import { mailAccountView, outgoing, readMailAccount, saveMailAccount, type MailAccountView, type MailPorts } from "./mail-account.ts";
import type { Activity, FromUi, MailAbout, Progress, ToUi, Upload, Work } from "./messages.ts";
import { makeDefault, modelViews, readModel, removeModel, saveModel } from "./model-settings.ts";
import type { Models, ModelSetting } from "./settings.ts";

const MAX_REQUEST = 2000;
// Far more than any app Mayfly writes, and a bound on what the page can make the extension build.
const MAX_ROUTES = 200_000;
const MAX_MESSAGE = 200;
const BUSY = "A request is in progress. Wait for it to finish.";
// The model's draft changes many times a second. The page gets the latest at most this often.
const DRAFT_MS = 150;
// Enough to see the last few hours of work, and small enough to keep in memory.
const ACTIVITY = 200;
const DONE: Record<Exclude<Progress["kind"], "remove">, string> = { create: "Made", change: "Changed", ask: "Answered a question about", deploy: "Deployed a version of", save: "Saved a hand edit to", rename: "Renamed", start: "Started" };

export interface ControllerPorts {
  readonly engine: Engine;
  readonly post: (message: ToUi) => Promise<unknown>;
  /** Tells the person that work ended, and whether it failed, for when they are looking elsewhere. Seen says whether the page had the focus. */
  readonly notify: (note: { readonly text: string; readonly failed: boolean; readonly seen: boolean }) => void;
  readonly openExternal: (url: string) => Promise<unknown>;
  readonly copy: (text: string) => Promise<unknown>;
  readonly settings: {
    models(): Models;
    saveModels(models: Models): Promise<void>;
    /** Whether the person works with the code too: versions, history, the editor, health and logs. */
    developer(): boolean;
    saveDeveloper(on: boolean): Promise<void>;
    /** Whether to start the apps Podman is not running when Podman Desktop starts. Off unless the person turns it on. */
    autostart(): boolean;
    saveAutostart(on: boolean): Promise<void>;
  };
  /** Checks that Mayfly has everything it needs. */
  readonly doctor: () => Promise<Examination>;
  /** API keys, each kept for the endpoint it was given for. */
  readonly keys: { has(endpoint: string): Promise<boolean>; save(endpoint: string, key: string): Promise<void> };
  readonly mail: MailPorts["mail"];
}

// One request at a time: each one reads and writes the whole state.
type Session = ControllerPorts & { working: Progress | null; draftDue: boolean; activity: Activity[]; focused: boolean };

/** Handles what the page asks for. The page is trusted with nothing: it names apps, never URLs, and never sees a secret. */
export function createController(ports: ControllerPorts): (message: unknown) => Promise<void> {
  const session: Session = { ...ports, working: null, draftDue: false, activity: [], focused: true };
  return async (message) => {
    const request = readRequest(message);
    if (request === undefined) return;
    try {
      await handle(request, session);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      note(session, "error", text);
      await ports.post({ type: "error", text, ...(error instanceof RecordedFailure ? { recorded: true } : {}) });
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
    case "open-link":
      return openLink(request.url, session);
    case "remove":
      return remove(request.name, session);
    case "copy":
      return copySignIn(request.what, session);
    case "show-password":
      if (request.email !== undefined) return session.post({ type: "password", email: request.email, password: (await session.engine.person(request.email)).password });
      return session.post({ type: "password", password: (await session.engine.owner()).password });
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
      await session.post({ type: "notice", text: "Sign-in email updated." });
      return showState(session);
    case "new-password":
      if (request.email !== undefined) return newPersonPassword(request.email, session);
      // Straight to the clipboard: like the old one, the new password never goes to the page.
      await session.copy((await session.engine.newPassword()).password);
      return session.post({ type: "notice", text: "Password reset. The new password is on your clipboard." });
    case "add-person":
      return addPerson(request.email, session);
    case "remove-person":
      return removePerson(request.email, session);
    case "email":
      return email(request, session);
    case "save-mail":
      return saveMail(request.account, request.password, session);
    case "remove-mail":
      await session.mail.remove();
      await session.post({ type: "notice", text: "Mayfly drafts emails in your mail app again." });
      return showState(session);
    case "share":
      return share(request.app, request.email, request.shared, session);
    case "developer":
      return saveDeveloper(request.on, session);
    case "autostart":
      await session.settings.saveAutostart(request.on);
      return showState(session);
    case "phone":
      return setPhone(request.on, session);
    case "start-stopped":
      return startStopped(session);
    case "updated":
      return startRunningAgain(session);
    case "focus":
      session.focused = request.on;
      return;
    case "code":
      return sendCode(request.app, request.version, session);
    case "health":
      return session.post({ type: "health", services: await session.engine.health() });
    case "ledger":
      return session.post({ type: "ledger", calls: await session.engine.ledger() });
    case "activity":
      return session.post({ type: "activity", entries: session.activity });
    case "doctor":
      return session.post({ type: "doctor", ...(await session.doctor()) });
    case "logs":
      return session.post({ type: "logs", pod: request.pod, container: request.container, lines: await session.engine.logs(request.pod, request.container) });
    case "ask":
      return ask(request.app, request.question.trim(), request.files ?? [], session);
    case "attachment":
      return sendAttachment(request.app, request.id, session);
    case "fix":
      return runAlone({ app: request.app, request: "Fix the errors in the app's logs", kind: "change" }, session, (watch) => session.engine.fix(request.app, watch));
    case "retry":
      return runAlone({ app: request.app, request: "Retry the last request", kind: "change" }, session, (watch) => session.engine.retry(request.app, watch));
    case "undo":
      return runAlone({ app: request.app, request: "Redeploy the previous version", kind: "deploy" }, session, (watch) => session.engine.undo(request.app, watch));
    case "rename":
      return rename(request.app, request.name.trim(), session);
    case "start":
      return runAlone({ app: request.app, request: "Start the app", kind: "start" }, session, (watch) => session.engine.start(request.app, watch));
    case "deploy":
      return deploy(request.app, request.version, session);
    case "save":
      return saveByHand(request.app, request.from, request.routes, request.message.trim(), session);
  }
}

async function send(work: Work, session: Session): Promise<void> {
  const files = filesOf(work.files ?? []);
  const problem = problemWithWork(work, session) ?? problemWithFiles(files);
  if (problem !== undefined) return void (await session.post({ type: "error", text: problem }));
  const { engine } = session;
  const kind = work.app === null ? "create" : "change";
  const model = work.model ?? session.settings.models().default;
  const job = (watch: Watcher): Promise<AppView> => (work.app === null ? engine.create(work.request, { model, watch, files }) : engine.change(work.app, work.request, watch, files));
  // Without the files, which the progress would otherwise carry to the page on every step.
  const app = await run({ app: work.app, request: work.request, kind }, session, job).catch(async (error: unknown) => {
    // A new app whose work was kept though it didn't start: the page goes to it, where the conversation says why.
    if (work.app === null && error instanceof RecordedFailure) {
      await showState(session);
      await session.post({ type: "created", name: error.app });
    }
    throw error;
  });
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

async function ask(app: string, question: string, uploads: readonly Upload[], session: Session): Promise<void> {
  const files = filesOf(uploads);
  const problem = problemWithWork({ app, request: question }, session) ?? problemWithFiles(files);
  if (problem !== undefined) return void (await session.post({ type: "error", text: problem }));
  await run({ app, request: question, kind: "ask" }, session, (watch) => session.engine.ask(app, question, watch, files));
}

/** The files the page sent, decoded. */
function filesOf(uploads: readonly Upload[]): FileData[] {
  return uploads.map(({ name, type, data }) => ({ name, type, data: new Uint8Array(Buffer.from(data, "base64")) }));
}

async function sendAttachment(app: string, id: string, session: Session): Promise<void> {
  const file = await session.engine.attachment(app, id);
  await session.post({ type: "attachment", app, id, name: file.name, mediaType: file.type, data: Buffer.from(file.data).toString("base64") });
}

// The page hears the new name before the state that no longer has the old one, so it stays on the app.
async function rename(app: string, to: string, session: Session): Promise<void> {
  await runAlone({ app, request: `Rename to \`${to}\``, kind: "rename" }, session, async (watch) => {
    const renamed = await session.engine.rename(app, to, watch);
    await session.post({ type: "renamed", from: app, to: renamed.name });
    return renamed;
  });
}

async function deploy(app: string, version: string, session: Session): Promise<void> {
  await runAlone({ app, request: `Deploy version \`${version}\``, kind: "deploy" }, session, (watch) => session.engine.deploy(app, version, watch));
}

/** Does work that needs nothing checked first, once no other work is under way. */
async function runAlone(work: Parameters<typeof run>[0], session: Session, job: Parameters<typeof run>[2]): Promise<void> {
  if (session.working !== null) return void (await session.post({ type: "error", text: BUSY }));
  await run(work, session, job);
}

async function saveByHand(app: string, from: string, routes: string, message: string, session: Session): Promise<void> {
  const problem = problemWithEdit(routes, message, session);
  if (problem !== undefined) return void (await session.post({ type: "error", text: problem }));
  const saved = await run({ app, request: message || "Manual edit", kind: "save" }, session, (watch) => session.engine.save(app, from, routes, message, watch));
  const version = saved.versions.at(-1);
  if (version !== undefined) await session.post({ type: "saved", app, version: version.id });
}

function problemWithEdit(routes: string, message: string, session: Session): string | undefined {
  if (session.working !== null) return BUSY;
  if (routes.trim() === "") return "routes.ts is empty.";
  if (routes.length > MAX_ROUTES) return `routes.ts must be ${MAX_ROUTES} characters or fewer.`;
  if (message.length > MAX_MESSAGE) return `Version notes are limited to ${MAX_MESSAGE} characters.`;
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
  const app = await job((step) => showProgress(step, session))
    .catch((error: unknown) => {
      session.notify({ text: `Could not finish “${work.request}”: ${error instanceof Error ? error.message : String(error)}`, failed: true, seen: session.focused });
      throw error;
    })
    .finally(() => {
      session.working = null;
    });
  // Deploying runs a version that passed, and answering makes none; anything else passed if its last attempt did.
  const last = app.versions.at(-1);
  const passed = ["deploy", "ask", "rename", "start"].includes(work.kind) || last === undefined || last.problem === null;
  const text = passed ? `${DONE[work.kind]} ${app.name}` : `Trial failed for ${app.name}`;
  note(session, passed ? "info" : "error", text);
  session.notify({ text, failed: !passed, seen: session.focused });
  await showState(session);
  return app;
}

function showProgress(step: Step, session: Session): void {
  if (session.working === null) return;
  session.working = { ...session.working, steps: withStep(session.working.steps, step) };
  if (step.kind !== "draft" && step.kind !== "thinking") return postProgress(session);
  // Only a developer sees the draft and the thinking, except of an answer, which is for everyone. A few times a second, not on every word.
  if (session.draftDue || (!session.settings.developer() && session.working.kind !== "ask")) return;
  session.draftDue = true;
  setTimeout(() => {
    session.draftDue = false;
    postProgress(session);
  }, DRAFT_MS);
}

/** Whatever comes after a draft replaces it, and the thinking so far replaces the thinking before it. Both hold all there is so far. */
function withStep(steps: readonly Step[], step: Step): readonly Step[] {
  const last = steps.at(-1)?.kind;
  const replaces = last === "draft" || (last === "thinking" && step.kind === "thinking");
  return replaces ? [...steps.slice(0, -1), step] : [...steps, step];
}

function postProgress(session: Session): void {
  if (session.working === null) return;
  // The page may have closed. When it opens again, the state it asks for brings it up to date.
  session.post({ type: "progress", working: session.working }).catch(() => undefined);
}

function problemWithWork(work: Work, session: Session): string | undefined {
  if (session.working !== null) return BUSY;
  if (work.request === "") return "Enter a request.";
  if (work.request.length > MAX_REQUEST) return `Requests are limited to ${MAX_REQUEST} characters.`;
  return undefined;
}

/** Opens a link from a reply in the browser. A model wrote it, so only a web page: nothing that runs or reads a file. */
async function openLink(url: string, session: Session): Promise<void> {
  const protocol = URL.canParse(url) ? new URL(url).protocol : "";
  if (protocol !== "https:" && protocol !== "http:") return void (await session.post({ type: "error", text: "Mayfly opens only links to web pages." }));
  await session.openExternal(url);
}

/** Opens an app, or a page of its auth proxy's, at the URL the engine knows. */
async function open(name: string, session: Session): Promise<void> {
  const app = (await session.engine.list()).find((candidate) => candidate.name === name);
  if (app !== undefined) await session.openExternal(app.url);
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
  await session.post({ type: "code", app, version, ...(await session.engine.written(app, version)) });
}

/** Starts each app Podman is not running, one at a time, as when Podman Desktop starts. It gives way to anything asked for meanwhile. */
async function startStopped(session: Session): Promise<void> {
  await startEach(await session.engine.stopped(), session);
}

// Starting an app builds its objects afresh, so each picks up what the new version changed in how apps run.
async function startRunningAgain(session: Session): Promise<void> {
  await startEach(await session.engine.running(), session);
}

async function startEach(apps: readonly string[], session: Session): Promise<void> {
  for (const app of apps) {
    if (session.working !== null) return;
    await run({ app, request: "Start the app", kind: "start" }, session, (watch) => session.engine.start(app, watch)).catch(async (error: unknown) => {
      const text = `Mayfly could not start ${app}: ${error instanceof Error ? error.message : String(error)}`;
      note(session, "error", text);
      await session.post({ type: "error", text });
    });
  }
}

async function saveDeveloper(on: boolean, session: Session): Promise<void> {
  await session.settings.saveDeveloper(on);
  await showState(session);
}

// Turning it on or off runs every app again, so like other work it waits its turn.
async function setPhone(on: boolean, session: Session): Promise<void> {
  if (session.working !== null) return void (await session.post({ type: "error", text: BUSY }));
  if (on) {
    const host = await session.engine.turnOnPhone();
    note(session, "info", `Phone access on at ${host}`);
    await session.post({ type: "notice", text: `Phone access is on. With Tailscale, your phone opens apps at \`${host}\`.` });
  } else {
    await session.engine.turnOffPhone();
    note(session, "info", "Phone access off");
    await session.post({ type: "notice", text: "Phone access is off." });
  }
  await showState(session);
}

// Adding, removing and sharing run apps again, so like other work they wait their turn.
async function addPerson(email: string, session: Session): Promise<void> {
  if (session.working !== null) return void (await session.post({ type: "error", text: BUSY }));
  const person = await session.engine.addPerson(email);
  note(session, "info", `Added ${person.email}`);
  await showState(session);
  await session.post({ type: "offer-email", about: "welcome", email: person.email });
}

async function removePerson(email: string, session: Session): Promise<void> {
  if (session.working !== null) return void (await session.post({ type: "error", text: BUSY }));
  await session.engine.removePerson(email);
  note(session, "info", `Removed ${email}`);
  await session.post({ type: "notice", text: `Removed \`${email}\`. No app lets them in now.` });
  await showState(session);
}

async function newPersonPassword(email: string, session: Session): Promise<void> {
  if (session.working !== null) return void (await session.post({ type: "error", text: BUSY }));
  const person = await session.engine.newPersonPassword(email);
  note(session, "info", `New password for ${person.email}`);
  await showState(session);
  await session.post({ type: "offer-email", about: "new-password", email: person.email });
}

// Other people reach apps only through the private network, so sharing needs phone access on.
async function share(app: string, email: string, shared: boolean, session: Session): Promise<void> {
  if (session.working !== null) return void (await session.post({ type: "error", text: BUSY }));
  const host = await session.engine.phoneAccess();
  if (shared && host === null) throw new Error("Turn on phone access in Settings first: other people open your apps through Tailscale.");
  await session.engine.share(app, email, shared);
  note(session, "info", shared ? `Shared ${app} with ${email}` : `Stopped sharing ${app} with ${email}`);
  await showState(session);
  if (shared) await session.post({ type: "offer-email", about: "shared", email, app });
}

/** Sends the email from the owner's mail account, or without one, opens it in their mail app for them to send. */
async function email(about: MailAbout, session: Session): Promise<void> {
  const mail = await mailFor(about, session);
  const account = await session.mail.account();
  if (account === undefined) return void (await session.openExternal(mailto(mail)));
  await session.mail.send(account, outgoing(mail, account)).catch((error: unknown) => {
    throw new Error(`Couldn't send the email to \`${mail.to}\`: ${error instanceof Error ? error.message : String(error)}`);
  });
  note(session, "info", `Emailed ${mail.to}`);
  await session.post({ type: "notice", text: `Sent to \`${mail.to}\`.` });
}

async function saveMail(account: MailAccountView, password: string, session: Session): Promise<void> {
  const problem = await saveMailAccount(account, password, session);
  if (problem !== undefined) return void (await session.post({ type: "error", text: problem }));
  const saved = await mailAccountView(session);
  await session.post({ type: "notice", text: `Mayfly sends email from \`${saved?.from}\` now.` });
  await showState(session);
}

async function mailFor(about: MailAbout, session: Session): Promise<Mail> {
  if (about.about !== "shared") {
    const person = await session.engine.person(about.email);
    return about.about === "welcome" ? welcomeMail(person) : newPasswordMail(person);
  }
  const host = await session.engine.phoneAccess();
  const app = (await session.engine.list()).find((candidate) => candidate.name === about.app);
  if (host === null || app === undefined) throw new Error(`\`${about.app}\` can't be reached from another device now. Turn on phone access in Settings first.`);
  return sharedMail(about.email, app.name, onPhone(app.url, host));
}

async function showState(session: Session): Promise<void> {
  await session.post({
    type: "state",
    apps: await session.engine.list(),
    owner: (await session.engine.owner()).email,
    people: await session.engine.people(),
    models: await modelViews(session),
    defaultModel: session.settings.models().default,
    spent: await session.engine.spent(),
    working: session.working,
    developer: session.settings.developer(),
    autostart: session.settings.autostart(),
    phoneHost: await session.engine.phoneAccess(),
    mail: await mailAccountView(session),
  });
}

// Messages come from the page, so each is checked for its shape before anything acts on it.
function readRequest(message: unknown): FromUi | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const { type, app, request, question, name, apiKey, on, version, what, from, routes, message: words, model, id, pod, container, starred, email, url, files, shared, about, account, password } = message as Record<string, unknown>;
  switch (type) {
    case "new-password":
    case "show-password":
      if (email === undefined) return { type };
      return typeof email === "string" ? { type, email } : undefined;
    case "add-person":
    case "remove-person":
      return typeof email === "string" ? { type, email } : undefined;
    case "email":
      if (typeof email !== "string") return undefined;
      if (about === "welcome" || about === "new-password") return { type, about, email };
      return about === "shared" && typeof app === "string" ? { type, about, email, app } : undefined;
    case "share":
      return typeof app === "string" && typeof email === "string" && typeof shared === "boolean" ? { type, app, email, shared } : undefined;
    case "save-mail": {
      const view = readMailAccount(account);
      return view !== undefined && typeof password === "string" ? { type, account: view, password } : undefined;
    }
    case "remove-mail":
      return { type };
    case "ready":
    case "health":
    case "ledger":
    case "doctor":
    case "activity":
      return { type };
    case "logs":
      return typeof pod === "string" && typeof container === "string" ? { type, pod, container } : undefined;
    case "copy":
      return what === "email" || what === "password" ? { type, what } : undefined;
    case "send": {
      const valid = (typeof app === "string" || app === null) && typeof request === "string" && (model === undefined || typeof model === "string");
      const sent = uploadsIn(files);
      return valid && sent !== undefined ? { type, app, request, ...(model === undefined ? {} : { model }), ...(sent.length === 0 ? {} : { files: sent }) } : undefined;
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
    case "remove":
      return typeof name === "string" ? { type, name } : undefined;
    case "open-link":
      return typeof url === "string" ? { type, url } : undefined;
    case "developer":
    case "autostart":
    case "focus":
    case "phone":
      return typeof on === "boolean" ? { type, on } : undefined;
    case "start-stopped":
    case "updated":
      return { type };
    case "save":
      return typeof app === "string" && typeof from === "string" && typeof routes === "string" && typeof words === "string" ? { type, app, from, routes, message: words } : undefined;
    case "ask": {
      const sent = uploadsIn(files);
      return typeof app === "string" && typeof question === "string" && sent !== undefined ? { type, app, question, ...(sent.length === 0 ? {} : { files: sent }) } : undefined;
    }
    case "attachment":
      return typeof app === "string" && typeof id === "string" ? { type, app, id } : undefined;
    case "fix":
    case "retry":
    case "undo":
    case "start":
      return typeof app === "string" ? { type, app } : undefined;
    case "rename":
      return typeof app === "string" && typeof name === "string" ? { type, app, name } : undefined;
    case "code":
    case "deploy":
      return typeof app === "string" && typeof version === "string" ? { type, app, version } : undefined;
    case "save-model": {
      const setting: ModelSetting | undefined = readModel(model);
      return setting !== undefined && typeof apiKey === "string" ? { type, model: setting, apiKey } : undefined;
    }
    default:
      return undefined;
  }
}

// More than the engine takes, so a page that sends too many hears why, rather than nothing.
const MAX_UPLOADS = 8;

/** Files sent from the page, each a name, a type and base64 contents, or none; undefined when they are anything else. */
function uploadsIn(value: unknown): Upload[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_UPLOADS) return undefined;
  const fine = value.every((file: unknown) => {
    const { name, type, data } = (file ?? {}) as Record<string, unknown>;
    return typeof name === "string" && typeof type === "string" && typeof data === "string";
  });
  return fine ? (value as Upload[]) : undefined;
}
