import type { AppView, ServiceHealth } from "../../../engine/engine.ts";
import type { Turn } from "../../../engine/state.ts";
import type { FromUi, Progress, ToUi, Work } from "../messages.ts";
import type { Check } from "../doctor.ts";
import type { ModelView } from "../messages.ts";
import { h, keepTime } from "./dom.ts";
import { tokens } from "./format.ts";
import { codeView } from "./code.ts";
import { doctorView } from "./doctor-view.ts";
import { healthView } from "./health.ts";
import { lightFor, type Light } from "./lights.ts";
import { logViewer } from "./logs.ts";
import { historyView } from "./history.ts";
import { openForm, renderModels, savedModel, setUpModels } from "./models.ts";
import { makingOf, progressView, tickClocks, whatChanged, type Showing } from "./progress.ts";

// Podman Desktop puts this function on every webview page, to send messages to the extension.
declare function acquirePodmanDesktopApi(): { postMessage(message: FromUi): void };

type State = Extract<ToUi, { type: "state" }>;
/** What the main area shows: a new app's empty conversation, an app's conversation, or the settings. */
type View = { readonly kind: "new" } | { readonly kind: "app"; readonly name: string; readonly tab: Tab } | { readonly kind: "settings" };
/** An app's conversation, or its history. */
type Tab = "chat" | "history" | "code" | "logs";

const TITLES: Record<Exclude<Progress["kind"], "remove">, string> = { create: "Writing your app", change: "Changing your app", restore: "Going back", edit: "Trying your edit" };

const NOTICE_MS = 4000;
const CONFIRM_MS = 4000;
const COPIED_MS = 1500;
const HEALTH_MS = 10_000;
// How close to the bottom of a conversation counts as following it.
const FOLLOW_PX = 48;
// Apps that work for one person in one browser, since an app keeps its data in the browser.
const EXAMPLES = [
  "Split our team's lunch bills and show who owes whom",
  "Track which plants I've watered and which are due today",
  "Scale a recipe's quantities for any number of people",
  "A packing list for a weekend trip that I can tick off",
];

const podmanDesktop = acquirePodmanDesktopApi();
const request = element<HTMLTextAreaElement>("request");
const composerModel = element<HTMLSelectElement>("composer-model");
const developer = element<HTMLInputElement>("developer");

let state: State | undefined;
let view: View = { kind: "new" };
/** Unsent text, kept for each conversation. */
const drafts = new Map<string, string>();
/** What the person sent last, to give back if it fails. */
let lastSent: Work | undefined;
/** The app whose code the person is editing by hand. */
let editing: string | undefined;
/** The app whose logs the Logs tab last asked for, so a redraw does not ask again. */
let appLogsShown: string | undefined;
/** Which version the Code tab shows, so a redraw leaves it alone. */
let codeShown = "";
/** Folds the person opened or closed, so a redraw leaves them as they were. */
const folds = new Map<string, boolean>();
/** Versions' code fetched from the extension, and the ones already asked for. */
const codes = new Map<string, string>();
const asked = new Set<string>();
let bannerTimer: number | undefined;
/** What the doctor found when last asked. */
let checks: readonly Check[] | undefined;
/** How the apps and the sign-in service were doing when Podman was last asked. */
let health: readonly ServiceHealth[] | undefined;
/** The model the person picked for the next new app, if not the default. */
let newAppModel: string | undefined;

setUpModels(post, () => render());
// One log reader in Settings for everything, Mayfly's activity included, and one for the app on screen.
const settingsLogs = logViewer(post, { activity: true });
const appLogs = logViewer(post, { activity: false });
element("settings-logs").append(settingsLogs.element);
element("app-logs").append(appLogs.element);
element("examples").replaceChildren(...EXAMPLES.map(exampleItem));

window.addEventListener("message", (event: MessageEvent<ToUi>) => receive(event.data));
element("new-app").addEventListener("click", () => go({ kind: "new" }));
element("show-settings").addEventListener("click", () => go({ kind: "settings" }));
element("add-key").addEventListener("click", () => state !== undefined && askForKey(state, shownApp()));
element("open-app").addEventListener("click", openApp);
element("tab-chat").addEventListener("click", () => showTab("chat"));
element("tab-history").addEventListener("click", () => showTab("history"));
element("tab-code").addEventListener("click", () => showTab("code"));
element("tab-logs").addEventListener("click", () => showTab("logs"));
element("edit-code").addEventListener("click", startEditing);
element("cancel-edit").addEventListener("click", () => {
  editing = undefined;
  render();
});
element("code-editor").addEventListener("submit", (event) => {
  event.preventDefault();
  saveEdit();
});
element("code-text").addEventListener("keydown", indentWithTab);
element("remove-app").addEventListener("click", removeApp);
for (const what of ["email", "password"] as const) element(`copy-${what}`).addEventListener("click", () => copySignIn(what));
element("composer").addEventListener("submit", (event) => {
  event.preventDefault();
  send();
});
request.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  send();
});
composerModel.addEventListener("change", pickModel);
element("refresh-health").addEventListener("click", askHealth);
element("run-doctor").addEventListener("click", askDoctor);
element("owner-form").addEventListener("submit", (event) => {
  event.preventDefault();
  post({ type: "owner-email", email: element<HTMLInputElement>("owner-email").value });
});
element("settings-copy-password").addEventListener("click", (event) => {
  post({ type: "copy", what: "password" });
  flash(event.currentTarget as HTMLElement, "Copied ✓");
});
element("new-password").addEventListener("click", makeNewPassword);
developer.addEventListener("change", () => post({ type: "developer", on: developer.checked }));

window.setInterval(tickClocks, 1000);
// The lights beside the apps follow what Podman says, asked again every little while the page is in view.
window.setInterval(() => document.visibilityState === "visible" && post({ type: "health" }), HEALTH_MS);
post({ type: "ready" });

function receive(message: ToUi): void {
  switch (message.type) {
    case "state":
      savedModel(true);
      return receiveState(message);
    case "progress":
      if (state !== undefined) state = { ...state, working: message.working };
      return render();
    case "code":
      codes.set(`${message.app}:${message.version}`, message.routes);
      return render();
    case "health":
      health = message.services;
      settingsLogs.offer(message.services);
      return render();
    case "doctor":
      checks = message.checks;
      return render();
    case "logs":
      settingsLogs.receiveLogs(message.pod, message.container, message.lines);
      return appLogs.receiveLogs(message.pod, message.container, message.lines);
    case "activity":
      return settingsLogs.receiveActivity(message.entries);
    case "created":
      if (view.kind === "new") go({ kind: "app", name: message.name, tab: "chat" });
      return;
    case "notice":
      return showBanner(message.text, "notice");
    case "error":
      savedModel(false);
      return showError(message.text);
  }
}

function receiveState(next: State): void {
  const previous = state;
  if (previous === undefined) post({ type: "health" });
  state = next;
  // Whatever the outcome, an error for it came before this.
  if (previous !== undefined && previous.working !== null && next.working === null) lastSent = undefined;
  if (view.kind === "app" && shownApp() === undefined) view = { kind: "new" };
  // On first use, Settings opens on the default model, so the person can paste its key.
  if (previous === undefined && !canWrite(next, undefined)) return askForKey(next, undefined);
  render();
}

function go(next: View): void {
  drafts.set(draftKey(view), request.value);
  view = next;
  request.value = drafts.get(draftKey(view)) ?? "";
  hideBanner();
  render();
  if (view.kind === "settings") {
    element<HTMLInputElement>("owner-email").value = state?.owner ?? "";
    askDoctor();
    askHealth();
    return settingsLogs.ask();
  }
  request.focus();
  // A conversation opens at its latest message; history and code open at the top.
  const thread = element("thread");
  if (view.kind === "app" && view.tab !== "chat") thread.scrollTop = 0;
  else scrollToEnd(thread);
}

function send(): void {
  const text = request.value.trim();
  if (text === "" || view.kind === "settings" || state?.working !== null || !canWrite(state, shownApp())) return;
  lastSent = { app: view.kind === "app" ? view.name : null, request: text, ...(view.kind === "new" && newAppModel !== undefined ? { model: newAppModel } : {}) };
  request.value = "";
  hideBanner();
  post({ type: "send", ...lastSent });
}

function exampleItem(text: string): HTMLLIElement {
  const control = document.createElement("button");
  control.type = "button";
  control.className = "example";
  control.textContent = text;
  control.addEventListener("click", () => {
    request.value = text;
    request.focus();
  });
  const item = document.createElement("li");
  item.append(control);
  return item;
}

// The chip says it copied, briefly, so the person knows without looking anywhere else.
function copySignIn(what: "email" | "password"): void {
  post({ type: "copy", what });
  const chip = element(`copy-${what}`);
  chip.classList.add("copied");
  window.setTimeout(() => chip.classList.remove("copied"), COPIED_MS);
}

/** For developers: how the app is running, and what its containers wrote. */
function renderAppLogs(app: AppView): void {
  const mine = health?.filter((service) => service.kind === "app" && service.name === app.name);
  element("app-health").replaceChildren(...healthView(mine));
  appLogs.offer(mine ?? []);
  if (appLogsShown === app.name) return;
  appLogsShown = app.name;
  appLogs.ask();
}

/** Behind the curtain: the code running now, and an editor to change it by hand. */
function renderCode(app: AppView, showing: Showing): void {
  const isEditing = editing === app.name;
  element("code-reading").hidden = isEditing;
  element("code-editor").hidden = !isEditing;
  if (isEditing) return;
  const base = startingPoint(app);
  const code = base === undefined ? undefined : showing.code(app.name, base.id);
  element<HTMLButtonElement>("edit-code").disabled = code === undefined || state?.working !== null;
  element("code-caption").textContent = base === undefined ? "No attempt has written any code yet." : `routes.ts · version ${base.id}${base.id === app.head ? ", running now" : ", the latest attempt"} · by ${base.by.name}`;
  const key = `${app.name}:${base?.id ?? ""}:${code === undefined ? "" : "loaded"}`;
  if (key === codeShown) return;
  codeShown = key;
  element("code-current").replaceChildren(code === undefined ? h("p", "quiet", base === undefined ? "" : "Fetching the code…") : codeView(code, "listing editable"));
}

/** What an edit starts from: the running version, or the latest attempt with code. */
function startingPoint(app: AppView): AppView["versions"][number] | undefined {
  return app.versions.find((version) => version.id === app.head) ?? app.versions.findLast((version) => version.lines > 0);
}

function startingCode(app: AppView): string | undefined {
  const base = startingPoint(app);
  return base === undefined ? undefined : codes.get(`${app.name}:${base.id}`);
}

function startEditing(): void {
  const app = shownApp();
  const code = app === undefined ? undefined : startingCode(app);
  if (app === undefined || code === undefined) return;
  editing = app.name;
  element<HTMLTextAreaElement>("code-text").value = code;
  element<HTMLInputElement>("code-message").value = "";
  render();
  element("code-text").focus();
}

function saveEdit(): void {
  if (editing === undefined) return;
  post({ type: "edit", app: editing, routes: element<HTMLTextAreaElement>("code-text").value, message: element<HTMLInputElement>("code-message").value });
  const app = editing;
  editing = undefined;
  codeShown = "";
  go({ kind: "app", name: app, tab: "chat" });
}

// A code editor indents with Tab rather than leaving the field.
function indentWithTab(event: KeyboardEvent): void {
  if (event.key !== "Tab" || event.shiftKey) return;
  event.preventDefault();
  const field = event.currentTarget as HTMLTextAreaElement;
  field.setRangeText("  ", field.selectionStart, field.selectionEnd, "end");
}

// Going back rebuilds and restarts the app, which the conversation shows as it happens.
function goBack(app: string, version: string): void {
  post({ type: "restore", app, version });
  go({ kind: "app", name: app, tab: "chat" });
}

function showTab(tab: Tab): void {
  if (view.kind === "app") go({ ...view, tab });
}

function openApp(): void {
  if (view.kind === "app") post({ type: "open", name: view.name });
}

// Removing an app loses its conversation and versions for good, so a dialog asks first, with keeping it the default.
function removeApp(): void {
  if (view.kind !== "app") return;
  const name = view.name;
  const dialog = element<HTMLDialogElement>("remove-dialog");
  element("remove-title").textContent = `Remove ${name}?`;
  element("confirm-remove").textContent = `Remove ${name}`;
  dialog.returnValue = "";
  dialog.addEventListener("close", () => dialog.returnValue === "remove" && post({ type: "remove", name }), { once: true });
  dialog.showModal();
}

// A new password stops the old one working, so it takes a second click.
let newPasswordArmed = false;

function makeNewPassword(): void {
  const control = element("new-password");
  if (newPasswordArmed) {
    newPasswordArmed = false;
    control.textContent = "Make a new password";
    return post({ type: "new-password" });
  }
  newPasswordArmed = true;
  control.textContent = "Sure? The old one stops working";
  window.setTimeout(() => {
    newPasswordArmed = false;
    control.textContent = "Make a new password";
  }, CONFIRM_MS);
}

/** Says something on a button for a moment, then puts its words back. */
function flash(control: HTMLElement, words: string): void {
  const before = control.textContent;
  control.textContent = words;
  window.setTimeout(() => (control.textContent = before), COPIED_MS);
}

function askDoctor(): void {
  checks = undefined;
  render();
  post({ type: "doctor" });
}

function askHealth(): void {
  health = undefined;
  render();
  post({ type: "health" });
}

/** The model an app uses, or a new app would: what the composer's picker shows. */
function activeModel(current: State, app: AppView | undefined): ModelView | undefined {
  const wanted = app === undefined ? (newAppModel ?? current.defaultModel) : (app.model ?? current.defaultModel);
  return current.models.find((model) => model.id === wanted) ?? current.models.find((model) => model.id === current.defaultModel);
}

function canWrite(current: State, app: AppView | undefined): boolean {
  return activeModel(current, app)?.hasApiKey === true;
}

function askForKey(current: State, app: AppView | undefined): void {
  openForm(activeModel(current, app));
  go({ kind: "settings" });
}

// Choosing another model for an app is kept in its conversation; for a new app, it waits for the first message.
function pickModel(): void {
  const app = shownApp();
  if (app === undefined) newAppModel = composerModel.value;
  else post({ type: "use-model", app: app.name, model: composerModel.value });
  render();
}

function render(): void {
  if (state === undefined) return;
  const app = shownApp();
  element("loading").hidden = true;
  renderSidebar(state);
  element("chat").hidden = view.kind === "settings";
  element("settings").hidden = view.kind !== "settings";
  developer.checked = state.developer;
  // What only developers see, Settings' health and logs among it.
  for (const part of document.querySelectorAll<HTMLElement>(".developer-only")) part.hidden = !state.developer;
  if (view.kind === "settings") {
    renderModels(state, post, () => render());
    element("health").replaceChildren(...healthView(health));
    element("doctor").replaceChildren(...doctorView(checks));
  }
  else renderChat(state, app);
  renderStatusbar(state, app);
}

function renderSidebar({ apps, working }: State): void {
  // Favourites first, each group in the order the apps were made.
  const ordered = [...apps.filter((app) => app.starred), ...apps.filter((app) => !app.starred)];
  element("apps").replaceChildren(...ordered.map((app) => appItem(app, lightFor(app, health, working?.app))));
  element("apps-heading").hidden = apps.length === 0;
  const newApp = element("new-app");
  markCurrent(newApp, view.kind === "new");
  newApp.querySelector(".spinner")?.remove();
  if (working?.app === null) newApp.append(spinner());
  markCurrent(element("show-settings"), view.kind === "settings");
}

// Built from text nodes only, so nothing in a name or a conversation can become markup.
function appItem(app: AppView, { colour, meaning }: Light): HTMLLIElement {
  const control = document.createElement("button");
  control.type = "button";
  control.className = "nav-item";
  control.title = meaning;
  const light = h("span", `light ${colour}`);
  light.setAttribute("aria-label", meaning);
  control.append(light, h("span", "app-name", app.name));
  markCurrent(control, view.kind === "app" && view.name === app.name);
  control.addEventListener("click", () => go({ kind: "app", name: app.name, tab: "chat" }));
  const star = h("button", `star${app.starred ? " starred" : ""}`, app.starred ? "★" : "☆");
  star.type = "button";
  star.title = app.starred ? "Remove from favourites" : "Add to favourites";
  star.setAttribute("aria-pressed", String(app.starred));
  star.addEventListener("click", () => post({ type: "star", app: app.name, starred: !app.starred }));
  return h("li", "app-item", control, star);
}

function renderChat(state: State, app: AppView | undefined): void {
  const working = state.working?.app === (app?.name ?? null) ? state.working : null;
  element("app-header").hidden = app === undefined;
  element("owner").textContent = state.owner;
  element("app-name").textContent = app?.name ?? "";
  const openApp = element<HTMLButtonElement>("open-app");
  openApp.disabled = app?.head === null;
  openApp.title = app?.head === null ? "No attempt has passed yet, so nothing is running." : "";
  // While Mayfly works on the app, and above all while it removes it, the app is left alone.
  const busy = state.working !== null && state.working.app === (app?.name ?? null);
  const removing = busy && state.working?.kind === "remove";
  element<HTMLButtonElement>("remove-app").disabled = busy;
  if (removing) openApp.disabled = true;
  for (const tab of element("app-tabs").querySelectorAll("button")) tab.disabled = removing;
  element("welcome").hidden = app !== undefined || working !== null;
  const writes = canWrite(state, app);
  element("needs-key").hidden = writes;
  element("examples").hidden = !writes;
  const turns = [...(app?.conversation ?? []), ...(working === null ? [] : [{ from: "person", text: working.request, at: working.since } as const])];
  const showing = showingFor(state);
  const items = turns.map((said) => turnItem(said, app === undefined ? [] : madeOf(said, app, showing)));
  const pending = working === null ? [] : [turn("mayfly", working.kind === "remove" ? h("p", "", spinner(), `Stopping and removing ${working.app ?? ""}…`) : progressView(working, TITLES[working.kind], showing))];
  const thread = element("thread");
  const following = thread.scrollHeight - thread.scrollTop - thread.clientHeight < FOLLOW_PX;
  // The Code tab is behind the curtain.
  // History and Code are for developers.
  const tab = view.kind !== "app" || !state.developer ? "chat" : view.tab;
  element("turns").hidden = tab !== "chat";
  element("turns").replaceChildren(...(tab === "chat" ? [...items, ...pending] : []));
  element("history").hidden = tab !== "history";
  element("history").replaceChildren(...(tab === "history" && app !== undefined ? [historyView(app, showing, { restore: (version) => goBack(app.name, version), busy: state.working !== null })] : []));
  for (const name of ["chat", "history", "code", "logs"] as const) element(`tab-${name}`).setAttribute("aria-selected", String(tab === name));
  element("logs-tab").hidden = tab !== "logs";
  if (tab === "logs" && app !== undefined) renderAppLogs(app);
  else appLogsShown = undefined;
  element("app-tabs").hidden = !state.developer;
  element("code-tab").hidden = tab !== "code";
  if (tab === "code" && app !== undefined) renderCode(app, showing);
  element("tab-history").textContent = `History · ${app?.versions.length ?? 0}`;
  if (following && tab === "chat") scrollToEnd(thread);
  for (const live of document.querySelectorAll<HTMLElement>(".live")) scrollToEnd(live);
  request.placeholder = app === undefined ? "Describe the app you need" : `Ask for a change to ${app.name}`;
  request.disabled = !writes || removing;
  element<HTMLButtonElement>("send").disabled = !writes || state.working !== null;
  composerModel.replaceChildren(...state.models.map((model) => new Option(model.label, model.id)));
  composerModel.value = activeModel(state, app)?.id ?? "";
  composerModel.disabled = state.working !== null;
}

/** Under each of Mayfly's replies, how it was made. */
function madeOf(said: Turn, app: AppView, showing: Showing): Node[] {
  if (said.from !== "mayfly" || said.versions.length === 0) return [];
  const versions = said.versions.flatMap((id) => app.versions.find((version) => version.id === id) ?? []);
  const made = makingOf(app.name, versions, said.took, showing);
  const [first, last] = [versions[0], versions.at(-1)];
  const changed = showing.developer && first?.parent != null && last?.problem === null;
  return changed ? [whatChanged(app.name, first.parent, last.id, showing), made] : [made];
}

function showingFor({ developer }: State): Showing {
  return {
    developer,
    isOpen: (key, byDefault) => folds.get(key) ?? byDefault,
    setOpen: (key, open) => {
      folds.set(key, open);
      render();
    },
    code: (app, version) => {
      const key = `${app}:${version}`;
      if (!asked.has(key)) {
        asked.add(key);
        post({ type: "code", app, version });
      }
      return codes.get(key);
    },
  };
}

function turnItem({ from, text, at }: Turn, extras: readonly Node[] = []): HTMLLIElement {
  const words = h("p", "", text);
  // When it was said, for anyone who wants to know.
  if (at !== 0) words.title = new Date(at).toLocaleString();
  return turn(from, h("div", "", words, ...extras));
}

function turn(from: Turn["from"], body: HTMLElement): HTMLLIElement {
  const item = document.createElement("li");
  item.className = `turn ${from}`;
  if (from === "mayfly") item.append(avatar());
  item.append(body);
  return item;
}

function spinner(): HTMLSpanElement {
  return keepTime(h("span", "spinner small"));
}

function scrollToEnd(box: HTMLElement): void {
  box.scrollTop = box.scrollHeight;
}

function avatar(): HTMLImageElement {
  const image = document.createElement("img");
  image.src = element<HTMLImageElement>("logo").src;
  image.alt = "";
  image.className = "avatar";
  return image;
}

function renderStatusbar(current: State, app: AppView | undefined): void {
  const { spent } = current;
  const model = activeModel(current, app);
  element("model-info").textContent = model === undefined ? "No model" : `${model.label}${model.hasApiKey ? "" : " · no API key"}`;
  const all = `All apps: ${tokens(spent)}`;
  element("tokens").textContent = app === undefined ? all : `${app.name}: ${tokens(app.spent)} · ${all}`;
}


function showError(text: string): void {
  showBanner(text, "error");
  const conversation = view.kind === "app" ? view.name : null;
  if (lastSent !== undefined && lastSent.app === conversation && view.kind !== "settings" && request.value === "") request.value = lastSent.request;
  lastSent = undefined;
}

function showBanner(text: string, kind: "notice" | "error"): void {
  const banner = element("banner");
  banner.textContent = text;
  banner.className = kind;
  banner.setAttribute("role", kind === "error" ? "alert" : "status");
  banner.hidden = false;
  window.clearTimeout(bannerTimer);
  if (kind === "notice") bannerTimer = window.setTimeout(hideBanner, NOTICE_MS);
}

function hideBanner(): void {
  element("banner").hidden = true;
}

function shownApp(): AppView | undefined {
  const shown = view;
  return shown.kind === "app" ? state?.apps.find((app) => app.name === shown.name) : undefined;
}

function draftKey(shown: View): string {
  return shown.kind === "app" ? `app:${shown.name}` : shown.kind;
}

function markCurrent(control: HTMLElement, current: boolean): void {
  if (current) control.setAttribute("aria-current", "page");
  else control.removeAttribute("aria-current");
}

function post(message: FromUi): void {
  podmanDesktop.postMessage(message);
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
