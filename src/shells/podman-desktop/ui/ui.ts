import type { AppView, ServiceHealth, Written } from "../../../engine/engine.ts";
import type { ModelCall, Turn } from "../../../engine/state.ts";
import type { FromUi, Progress, ToUi, Work } from "../messages.ts";
import type { Examination } from "../doctor.ts";
import type { ModelView } from "../messages.ts";
import { h, keepTime } from "./dom.ts";
import { changes, codeView } from "./code.ts";
import { codeEditor } from "./editor.ts";
import { commandMenu } from "./command-menu.ts";
import { parse, suggestions, type Command } from "./commands.ts";
import { nameChip, withChips } from "./chips.ts";
import { doctorView } from "./doctor-view.ts";
import { healthView } from "./health.ts";
import { lightFor, type Light } from "./lights.ts";
import { ledgerView } from "./ledger-view.ts";
import { logViewer } from "./logs.ts";
import { historyView, versionPanel } from "./history.ts";
import { addIcons, icon } from "./icons.ts";
import { renderStatusbar, setUpStatusbar } from "./statusbar.ts";
import { openForm, renderModels, savedModel, setUpModels } from "./models.ts";
import { popover } from "./popover.ts";
import { makingOf, progressView, tickClocks, whatChanged, type Showing } from "./progress.ts";

// Podman Desktop puts this function on every webview page, to send messages to the extension.
declare function acquirePodmanDesktopApi(): { postMessage(message: FromUi): void };

type State = Extract<ToUi, { type: "state" }>;
/** What the main area shows: a new app's empty conversation, an app's conversation, or the settings. */
type View = { readonly kind: "new" } | { readonly kind: "app"; readonly name: string; readonly tab: Tab } | { readonly kind: "settings"; readonly tab: SettingsTab };
/** An app's conversation, or its history. */
type Tab = "chat" | "history" | "code" | "logs";
/** What Mayfly needs, the models, how everything is running, or how the models did. */
type SettingsTab = "general" | "models" | "logs" | "usage";

const SETTINGS_TABS: readonly SettingsTab[] = ["general", "models", "logs", "usage"];
// Logs and usage are for developers.
const DEVELOPER_TABS: readonly SettingsTab[] = ["logs", "usage"];

const TITLES: Record<Exclude<Progress["kind"], "remove">, string> = { create: "Writing your app", change: "Changing your app", ask: "Answering", deploy: "Deploying", save: "Trying your edit", rename: "Renaming", start: "Starting" };

const NOTICE_MS = 4000;
const CONFIRM_MS = 4000;
const COPIED_MS = 1500;
// Long enough to read what removing does before the button lets you.
const REMOVE_WAIT_S = 2;
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

addIcons(document);

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
/** The app whose code the person is editing by hand, and the version the edit carries on from. */
let editing: { readonly app: string; readonly from: string } | undefined;
/** Whether the editor holds changes not saved yet. */
let unsaved = false;
/** The version the deploy dialog asks about, and what it last showed, so a redraw leaves it alone. */
let deploying: { readonly app: string; readonly version: string; shown: string } | undefined;
/** The app whose logs the Logs tab last asked for, so a redraw does not ask again. */
let appLogsShown: string | undefined;
/** Which version the Code tab shows, so a redraw leaves it alone. */
let codeShown = "";
/** The version shown in full beside the history, if any. */
let picked: { readonly app: string; readonly version: string } | undefined;
/** Folds the person opened or closed, so a redraw leaves them as they were. */
const folds = new Map<string, boolean>();
/** Versions' code and thinking fetched from the extension, and the ones already asked for. */
const written = new Map<string, Written>();
const asked = new Set<string>();
let bannerTimer: number | undefined;
/** What the doctor found when last asked. */
let examination: Examination | undefined;
/** Every call to a model, when last asked. */
let calls: readonly ModelCall[] | undefined;
/** How the apps and the sign-in service were doing when Podman was last asked. */
let health: readonly ServiceHealth[] | undefined;
/** The model the person picked for the next new app, if not the default. */
let newAppModel: string | undefined;

setUpModels(post, () => render());
setUpStatusbar((tab) => go({ kind: "settings", tab }));
popover(element("show-sign-in"), element("sign-in-popover"));
commandMenu(request, element("command-menu"), (text) => suggestions(text, { app: view.kind === "app", models: state?.models.map((model) => model.label) ?? [] }));
// One log reader in Settings for everything, Mayfly's activity included, and one for the app on screen.
const settingsLogs = logViewer(post, { activity: true });
const ledger = ledgerView();
const appLogs = logViewer(post, { activity: false });
const editor = codeEditor({ field: element<HTMLTextAreaElement>("code-text"), shadow: element("code-shadow"), gutter: element("code-gutter"), changed: (changed) => {
  unsaved = changed;
  element("file-changed").hidden = !changed;
  const app = shownApp();
  if (app !== undefined) editorButtons(app);
} });
element("settings-logs").append(settingsLogs.element);
element("ledger").append(ledger.element);
element("app-logs").append(appLogs.element);
element("examples").replaceChildren(...EXAMPLES.map(exampleItem));

window.addEventListener("message", (event: MessageEvent<ToUi>) => receive(event.data));
element("new-app").addEventListener("click", () => go({ kind: "new" }));
element("show-settings").addEventListener("click", () => go({ kind: "settings", tab: "general" }));
for (const tab of SETTINGS_TABS) element(`settings-tab-${tab}`).addEventListener("click", () => go({ kind: "settings", tab }));
element("add-key").addEventListener("click", () => state !== undefined && askForKey(state, shownApp()));
element("open-app").addEventListener("click", openApp);
element("start-app").addEventListener("click", () => view.kind === "app" && startWork({ type: "start", app: view.name }, false));
element("tab-chat").addEventListener("click", () => showTab("chat"));
element("tab-history").addEventListener("click", () => showTab("history"));
element("tab-code").addEventListener("click", () => showTab("code"));
element("tab-logs").addEventListener("click", () => showTab("logs"));
element("edit-code").addEventListener("click", () => {
  const app = shownApp();
  const base = app === undefined ? undefined : startingPoint(app);
  if (app !== undefined && base !== undefined) startEditing(app, base.id);
});
element("close-editor").addEventListener("click", () => {
  editing = undefined;
  render();
});
element("code-editor").addEventListener("submit", (event) => {
  event.preventDefault();
  saveEdit();
});
element("deploy-edit").addEventListener("click", () => editing !== undefined && askToDeploy(editing.app, editing.from));
document.addEventListener("keydown", (event) => event.key === "Escape" && picked !== undefined && pick(undefined));
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
element<HTMLInputElement>("autostart").addEventListener("change", (event) => post({ type: "autostart", on: (event.target as HTMLInputElement).checked }));

window.setInterval(tickClocks, 1000);
// The lights beside the apps follow what Podman says, asked again every little while the page is in view.
window.setInterval(() => document.visibilityState === "visible" && post({ type: "health" }), HEALTH_MS);
post({ type: "ready" });

function receive(message: ToUi): void {
  switch (message.type) {
    case "state": {
      const saved = savedModel(true);
      receiveState(message);
      // The model saved just now may have a new key, so the doctor tries it again.
      if (saved) askDoctor();
      return;
    }
    case "progress":
      if (state !== undefined) state = { ...state, working: message.working };
      return render();
    case "code":
      written.set(`${message.app}:${message.version}`, { routes: message.routes, thinking: message.thinking });
      return render();
    case "ledger":
      calls = message.calls;
      return render();
    case "health":
      health = message.services;
      settingsLogs.offer(message.services);
      return render();
    case "doctor":
      examination = message;
      return render();
    case "logs":
      settingsLogs.receiveLogs(message.pod, message.container, message.lines);
      return appLogs.receiveLogs(message.pod, message.container, message.lines);
    case "activity":
      return settingsLogs.receiveActivity(message.entries);
    case "created":
      if (view.kind === "new") go({ kind: "app", name: message.name, tab: "chat" });
      return;
    case "saved":
      carryOn(message.app, message.version);
      return render();
    case "renamed":
      return followRename(message.from, message.to);
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
  // The ledger grows when work ends, which sends the state.
  if (view.kind === "settings") post({ type: "ledger" });
  // On first use, Settings opens on the default model, so the person can paste its key.
  if (previous === undefined && !canWrite(next, undefined)) return askForKey(next, undefined);
  render();
}

function go(next: View): void {
  const arriving = next.kind === "settings" && view.kind !== "settings";
  drafts.set(draftKey(view), request.value);
  view = next;
  request.value = drafts.get(draftKey(view)) ?? "";
  hideBanner();
  render();
  if (view.kind === "settings") {
    element("settings-body").scrollTop = 0;
    if (arriving) askSettings();
    return;
  }
  request.focus();
  // A conversation opens at its latest message; history and code open at the top.
  const thread = element("thread");
  if (view.kind === "app" && view.tab !== "chat") thread.scrollTop = 0;
  else scrollToEnd(thread);
}

function send(): void {
  const text = request.value.trim();
  if (text === "" || view.kind === "settings") return;
  const typed = parse(text);
  if (typed.kind === "unknown") return showError(`Mayfly has no /${typed.name} command. Type / to see the ones it has.`);
  if (typed.kind === "command") return runCommand(typed.command, typed.argument);
  if (state?.working !== null || !canWrite(state, shownApp())) return;
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

/** Behind the curtain: the code running now, and an editor to change any version of it by hand. */
function renderCode(app: AppView, showing: Showing): void {
  const from = editing?.app === app.name ? editing.from : undefined;
  element("code-tab").classList.toggle("editing", from !== undefined);
  element("code-reading").hidden = from !== undefined;
  element("code-editor").hidden = from === undefined;
  if (from !== undefined) return renderEditor(app, from);
  const base = startingPoint(app);
  const code = base === undefined ? undefined : showing.code(app.name, base.id);
  element<HTMLButtonElement>("edit-code").disabled = code === undefined || state?.working !== null;
  element("code-caption").textContent = base === undefined ? "No attempt has written any code yet." : `routes.ts · version ${base.id}${base.id === app.head ? ", running now" : ", the latest attempt"} · by ${base.by.name}`;
  const key = `${app.name}:${base?.id ?? ""}:${code === undefined ? "" : "loaded"}`;
  if (key === codeShown) return;
  codeShown = key;
  element("code-current").replaceChildren(code === undefined ? h("p", "quiet", base === undefined ? "" : "Fetching the code…") : codeView(code, "listing editable"));
}

/** The editor's version, how its last save went, and what can be done now. */
function renderEditor(app: AppView, from: string): void {
  const version = app.versions.find((kept) => kept.id === from);
  const saving = state?.working?.kind === "save" && state.working.app === app.name;
  const status = version === undefined ? "" : version.id === app.head ? "running now" : version.problem === null ? "passed, not running" : "failed";
  element("editor-base").textContent = `routes.ts · version ${from}${status === "" ? "" : `, ${status}`}`;
  const problem = !saving && version?.problem != null ? [h("p", "", `Version ${from} didn't pass its trial. Fix it and save again:`), h("pre", "problem", version.problem)] : [];
  element("editor-status").replaceChildren(...(saving ? [h("p", "", spinner(), " Building and trying it…")] : problem));
  element("editor-status").hidden = !saving && problem.length === 0;
  element<HTMLTextAreaElement>("code-text").readOnly = saving;
  editorButtons(app);
}

// Saving needs changes; deploying needs none left unsaved, and a version that passed and is not running yet.
function editorButtons(app: AppView): void {
  if (editing?.app !== app.name) return;
  const busy = state?.working !== null;
  const version = app.versions.find((kept) => kept.id === editing?.from);
  element<HTMLButtonElement>("save-edit").disabled = !unsaved || busy;
  const why = unsaved ? "Save your changes first" : version?.problem != null ? "This version didn't pass its trial" : version?.id === app.head ? "This version is running now" : "";
  const deploy = element<HTMLButtonElement>("deploy-edit");
  deploy.disabled = why !== "" || busy;
  deploy.title = why || "Run this version at the app's address";
}

/** What an edit starts from: the running version, or the latest attempt with code. */
function startingPoint(app: AppView): AppView["versions"][number] | undefined {
  return app.versions.find((version) => version.id === app.head) ?? app.versions.findLast((version) => version.lines > 0);
}

/** Opens the editor on a version whose code has been fetched. The running version's code is fetched too, for the deploy dialog. */
function startEditing(app: AppView, from: string): void {
  const code = written.get(`${app.name}:${from}`)?.routes;
  if (code === undefined) return;
  if (app.head !== null) fetchWritten(app.name, app.head);
  editing = { app: app.name, from };
  element<HTMLInputElement>("code-message").value = "";
  pick(undefined);
  go({ kind: "app", name: app.name, tab: "code" });
  editor.load(code);
}

function saveEdit(): void {
  if (editing === undefined || !unsaved) return;
  post({ type: "save", app: editing.app, from: editing.from, routes: editor.edit().after, message: element<HTMLInputElement>("code-message").value });
}

/** The editor carries on from the version it saved, whose code it already holds. */
function carryOn(app: string, version: string): void {
  if (editing?.app !== app) return;
  written.set(`${app}:${version}`, { routes: editor.edit().after, thinking: "" });
  editing = { app, from: version };
  element<HTMLInputElement>("code-message").value = "";
  editor.saved();
}

/** Shows how a version differs from the one running, and deploys it only when the person says so. */
function askToDeploy(app: string, version: string): void {
  deploying = { app, version, shown: "" };
  const dialog = element<HTMLDialogElement>("deploy-dialog");
  dialog.returnValue = "";
  dialog.addEventListener(
    "close",
    () => {
      if (dialog.returnValue === "deploy") deploy(app, version);
      deploying = undefined;
    },
    { once: true },
  );
  renderDeployDialog();
  dialog.showModal();
}

// Redrawn as the code of either version arrives, and only then, so a long diff keeps its place.
function renderDeployDialog(): void {
  const app = state?.apps.find((kept) => kept.name === deploying?.app);
  if (deploying === undefined || app === undefined || state === undefined) return;
  const showing = showingFor(state);
  const before = app.head === null ? "" : showing.code(app.name, app.head);
  const after = showing.code(app.name, deploying.version);
  const ready = before !== undefined && after !== undefined;
  const key = `${app.head ?? ""}:${String(ready)}`;
  if (deploying.shown === key) return;
  deploying.shown = key;
  element("deploy-title").replaceChildren("Deploy version ", versionChip(deploying.version), " of ", nameChip(app.name), "?");
  element<HTMLButtonElement>("confirm-deploy").disabled = !ready;
  const replaces = app.head === null ? ["Nothing is running yet."] : ["It replaces version ", versionChip(app.head), ", running now, at the same address."];
  element("deploy-note").replaceChildren(...replaces, " It passed its trial when it was made.");
  if (!ready) return void element("deploy-changes").replaceChildren(h("p", "quiet", "Fetching the code…"));
  const { view, added, removed } = changes(before, after);
  element("deploy-changes").replaceChildren(h("p", "diff-file", icon("file"), "routes.ts", h("span", "diff-added", `+${added}`), h("span", "diff-removed", `−${removed}`)), view);
}

// Deploying rebuilds and restarts the app, which the conversation shows as it happens.
function deploy(app: string, version: string): void {
  pick(undefined);
  post({ type: "deploy", app, version });
  go({ kind: "app", name: app, tab: "chat" });
}

/** Shows a version in full beside the history, or closes the panel for none. */
function pick(next: typeof picked): void {
  picked = next;
  render();
  document.querySelector(".history-row.picked")?.scrollIntoView({ block: "nearest" });
}

function showTab(tab: Tab): void {
  if (view.kind === "app") go({ ...view, tab });
}

function openApp(): void {
  if (view.kind === "app") post({ type: "open", name: view.name });
}

// Removing an app loses its conversation and versions for good, so a dialog asks first, with keeping it the default.
/** Does what a command says, or says what it is missing. What follows the command stays in the composer until it is done. */
function runCommand(command: Command, argument: string): void {
  if (command.needsApp && view.kind !== "app") return showError(`/${command.name} works in an app's conversation.`);
  if (command.takes !== undefined && argument === "") return showError(`Type ${command.takes} after /${command.name}.`);
  if (command.name === "model") return useModelNamed(argument);
  if (command.name === "remove") {
    request.value = "";
    return removeApp();
  }
  // Every command left acts on the app on screen.
  if (view.kind !== "app") return;
  const app = view.name;
  if (command.name === "ask") return startWork({ type: "ask", app, question: argument }, true);
  if (command.name === "rename") return askToRename(app, argument);
  startWork({ type: command.name, app }, command.name === "fix" || command.name === "retry");
}

/** Renames the app only once the person agrees to the redeploy it takes. Until then, the command stays in the composer. */
function askToRename(app: string, to: string): void {
  const dialog = element<HTMLDialogElement>("rename-dialog");
  element("rename-title").replaceChildren("Rename ", nameChip(app), " to ", nameChip(to), "?");
  dialog.returnValue = "";
  dialog.addEventListener("close", () => dialog.returnValue === "rename" && startWork({ type: "rename", app, name: to }, false), { once: true });
  dialog.showModal();
}

/** The page follows a renamed app, before the state with its new name comes: its conversation stays on screen, and the editor and the picked version close. */
function followRename(from: string, to: string): void {
  if (state !== undefined) state = { ...state, apps: state.apps.map((app) => (app.name === from ? { ...app, name: to } : app)) };
  if (editing?.app === from) editing = undefined;
  if (picked?.app === from) picked = undefined;
  if (view.kind === "app" && view.name === from) go({ ...view, name: to });
  else render();
}

/** Starts the work a command asks for, unless other work is under way. Work that calls the model needs its key, like a request. */
function startWork(message: FromUi, callsModel: boolean): void {
  if (state?.working !== null || (callsModel && !canWrite(state, shownApp()))) return;
  request.value = "";
  hideBanner();
  post(message);
}

function useModelNamed(label: string): void {
  const model = state?.models.find((known) => known.label.toLowerCase() === label.toLowerCase());
  if (model === undefined) return showError(`There is no model called ${label}. Type /model and pick one.`);
  request.value = "";
  composerModel.value = model.id;
  pickModel();
}

/** Asks before removing the app on screen, from its Remove button or /remove alike. The button to go ahead waits a moment first. */
function removeApp(): void {
  if (view.kind !== "app") return;
  const name = view.name;
  const dialog = element<HTMLDialogElement>("remove-dialog");
  const confirm = element<HTMLButtonElement>("confirm-remove");
  element("remove-title").replaceChildren("Remove ", nameChip(name), "?");
  let left = REMOVE_WAIT_S;
  const count = (): void => {
    confirm.disabled = left > 0;
    confirm.replaceChildren("Remove ", nameChip(name), left > 0 ? ` (${left})` : "");
  };
  count();
  const tick = window.setInterval(() => {
    left--;
    count();
    if (left === 0) window.clearInterval(tick);
  }, 1000);
  dialog.returnValue = "";
  dialog.addEventListener(
    "close",
    () => {
      window.clearInterval(tick);
      if (dialog.returnValue === "remove") post({ type: "remove", name });
    },
    { once: true },
  );
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

// Settings asks for everything it shows as it opens, whichever tab it opens on, so switching tabs never waits.
function askSettings(): void {
  element<HTMLInputElement>("owner-email").value = state?.owner ?? "";
  askDoctor();
  askHealth();
  post({ type: "ledger" });
  settingsLogs.ask();
}

function askDoctor(): void {
  examination = undefined;
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
  go({ kind: "settings", tab: "models" });
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
  element<HTMLInputElement>("autostart").checked = state.autostart;
  if (view.kind === "settings") renderSettings(state, view.tab);
  else renderChat(state, app);
  renderStatusbar(state, app, activeModel(state, app), health);
  renderDeployDialog();
}

function renderSettings(current: State, wanted: SettingsTab): void {
  const tab = current.developer || !DEVELOPER_TABS.includes(wanted) ? wanted : "general";
  for (const name of SETTINGS_TABS) {
    element(`settings-tab-${name}`).hidden = !current.developer && DEVELOPER_TABS.includes(name);
    element(`settings-tab-${name}`).setAttribute("aria-selected", String(tab === name));
    element(`settings-${name}-tab`).hidden = tab !== name;
  }
  renderModels(current, examination?.models, post, () => render());
  element("doctor").replaceChildren(...doctorView(examination?.ready));
  element("health").replaceChildren(...healthView(health));
  ledger.show(calls, { spent: current.spent, apps: current.apps.map((app) => app.name) });
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
  const star = h("button", `star${app.starred ? " starred" : ""}`, icon("star"));
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
  // A stopped app gets a way to run again; Open app would find nothing there.
  const stopped = app !== undefined && !busy && lightFor(app, health, state.working?.app).colour === "red";
  element("start-app").hidden = !stopped;
  openApp.classList.toggle("primary", !stopped);
  openApp.classList.toggle("secondary", stopped);
  for (const tab of element("app-tabs").querySelectorAll("button")) tab.disabled = removing;
  element("welcome").hidden = app !== undefined || working !== null;
  const writes = canWrite(state, app);
  element("needs-key").hidden = writes;
  element("examples").hidden = !writes;
  const turns = [...(app?.conversation ?? []), ...(working === null ? [] : [{ from: "person", text: working.request, at: working.since } as const])];
  const showing = showingFor(state);
  const items = turns.map((said) => turnItem(said, app === undefined ? [] : madeOf(said, app, showing)));
  const pending = working === null ? [] : [turn("mayfly", pendingView(working, showing))];
  const thread = element("thread");
  const following = thread.scrollHeight - thread.scrollTop - thread.clientHeight < FOLLOW_PX;
  // The Code tab is behind the curtain.
  // History and Code are for developers.
  const tab = view.kind !== "app" || !state.developer ? "chat" : view.tab;
  element("turns").hidden = tab !== "chat";
  element("turns").replaceChildren(...(tab === "chat" ? [...items, ...pending] : []));
  element("history").hidden = tab !== "history";
  renderHistory(tab === "history" ? app : undefined, showing, state.working === null);
  for (const name of ["chat", "history", "code", "logs"] as const) element(`tab-${name}`).setAttribute("aria-selected", String(tab === name));
  element("logs-tab").hidden = tab !== "logs";
  if (tab === "logs" && app !== undefined) renderAppLogs(app);
  else appLogsShown = undefined;
  element("app-tabs").hidden = !state.developer;
  element("code-tab").hidden = tab !== "code";
  if (tab === "code" && app !== undefined) renderCode(app, showing);
  element("history-label").textContent = `History · ${app?.versions.length ?? 0}`;
  if (following && tab === "chat") scrollToEnd(thread);
  for (const live of document.querySelectorAll<HTMLElement>(".live")) scrollToEnd(live);
  request.placeholder = app === undefined ? "Describe the app you need" : "Ask for a change, or type / for commands";
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
    code: (app, version) => fetchWritten(app, version)?.routes,
    thinking: (app, version) => fetchWritten(app, version)?.thinking,
  };
}

/** A version's code and thinking, asked for the first time they are wanted. */
function fetchWritten(app: string, version: string): Written | undefined {
  const key = `${app}:${version}`;
  if (!asked.has(key)) {
    asked.add(key);
    post({ type: "code", app, version });
  }
  return written.get(key);
}

/** The history, one line per version, and beside it the version picked, if it is this app's. */
function renderHistory(app: AppView | undefined, showing: Showing, idle: boolean): void {
  const version = app?.versions.find((kept) => picked?.app === app.name && kept.id === picked.version);
  // Picking the version shown again closes it.
  const toggle = (name: string, id: string): void => pick(version?.id === id ? undefined : { app: name, version: id });
  element("history").replaceChildren(...(app === undefined ? [] : [historyView(app, version?.id, (id) => toggle(app.name, id))]));
  const panel = element("version-panel");
  panel.hidden = version === undefined;
  if (app === undefined || version === undefined) return panel.replaceChildren();
  // Editing needs the version's code, which the panel fetches to show what changed.
  const editable = showing.code(app.name, version.id) !== undefined;
  const actions = idle ? { deploy: (id: string) => askToDeploy(app.name, id), ...(editable ? { edit: (id: string) => startEditing(app, id) } : {}) } : {};
  panel.replaceChildren(...versionPanel(app, version, showing, { pick: (id) => pick({ app: app.name, version: id }), close: () => pick(undefined), ...actions }));
}

function turnItem({ from, text, at }: Turn, extras: readonly Node[] = []): HTMLLIElement {
  const words = h("p", "", ...withChips(text));
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

function versionChip(id: string): HTMLElement {
  return h("code", "version-id", id);
}

/** The work under way, as Mayfly's next turn in the conversation: an answer as it is written, or the stages of the work. */
function pendingView(working: Progress, showing: Showing): HTMLElement {
  if (working.kind === "remove") return h("p", "", spinner(), " Stopping and removing ", nameChip(working.app ?? ""), "…");
  if (working.kind !== "ask") return progressView(working, TITLES[working.kind], showing);
  const draft = working.steps.findLast((step) => step.kind === "draft");
  return draft?.kind === "draft" ? h("p", "", draft.text) : h("p", "", spinner(), " Thinking about your question…");
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
