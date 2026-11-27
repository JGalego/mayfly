import type { AppView, ServiceHealth, Written } from "../../../engine/engine.ts";
import type { ModelCall, Turn } from "../../../engine/state.ts";
import type { FromUi, Progress, ToUi, Upload, Work } from "../messages.ts";
import type { Examination } from "../doctor.ts";
import type { ModelView } from "../messages.ts";
import { h } from "./dom.ts";
import { changes, codeView } from "./code.ts";
import { codeEditor } from "./editor.ts";
import { findBar } from "./find-bar.ts";
import { threadFind } from "./thread-find.ts";
import { imageUrl, uploads } from "./uploads.ts";
import { chooseTab, keyboardTabs } from "./tabs.ts";
import { commandMenu } from "./command-menu.ts";
import { parse, suggestions, type Command } from "./commands.ts";
import { nameChip, withChips } from "./chips.ts";
import { filesOf, pendingView, spinner, turn, turnItem, type Speaking } from "./turns.ts";
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
import { passwordCard, PASSWORD_SHOWN_MS } from "./password-card.ts";
import { offerEmail, renderPeople, renderShare, settleSharing, setUpPeople, showPersonPassword } from "./people.ts";
import { renderMail, savedMail, setUpMail } from "./mail.ts";
import { qrCode } from "./qr.ts";
import { onPhone } from "../../../core/phone.ts";
import { phonePageUrl } from "../phone-creation.ts";
import type { PhoneView } from "../../../engine/engine.ts";
import { makingOf, tickClocks, whatChanged, type Showing } from "./progress.ts";

// Podman Desktop puts this function on every webview page, to send messages to the extension.
declare function acquirePodmanDesktopApi(): { postMessage(message: FromUi): void };

type State = Extract<ToUi, { type: "state" }>;
/** What the main area shows: a new app's empty conversation, an app's conversation, or the settings. */
type View = { readonly kind: "new" } | { readonly kind: "app"; readonly name: string; readonly tab: Tab } | { readonly kind: "settings"; readonly tab: SettingsTab };
/** An app's conversation, or its history. */
type Tab = "chat" | "history" | "code" | "logs";
/** What Mayfly needs, the models, how everything is running, or how the models did. */
type SettingsTab = "general" | "people" | "models" | "logs" | "usage";

const SETTINGS_TABS: readonly SettingsTab[] = ["general", "people", "models", "logs", "usage"];
// Logs and usage are for developers.
const DEVELOPER_TABS: readonly SettingsTab[] = ["logs", "usage"];


// Links open by way of the extension, and thumbnails are fetched the first time they're wanted.
const SPEAKING: Speaking = { open: openLink, thumbnail: thumbnailOf, logo: () => element<HTMLImageElement>("logo").src };

const NOTICE_MS = 4000;
const CONFIRM_MS = 4000;
const COPIED_MS = 1500;
// Long enough to read what removing does before the button lets you.
const REMOVE_WAIT_S = 2;
const FIND_APPS_FROM = 6;
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
/** Why the work last asked for in a conversation failed, said there until the person asks for something else. */
let failed: { readonly app: string | null; readonly text: string } | undefined;
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
/** The version the one shown beside the history is compared with, until another is shown. */
let comparing: { readonly app: string; readonly version: string; readonly with: string } | undefined;
/** The version shown in full beside the history, if any. */
let picked: { readonly app: string; readonly version: string } | undefined;
/** Folds the person opened or closed, so a redraw leaves them as they were, and how often they changed. */
const folds = new Map<string, boolean>();
let foldsChanged = 0;
/** The conversation's turns as last built, what they were built from, and what the conversation shows now. */
let builtTurns: { readonly key: string; readonly items: readonly HTMLElement[] } | undefined;
let turnsShown = "";
let pendingShown: readonly HTMLElement[] = [];
/** Attached images to show, by file id, and the ones already asked for. */
const thumbnails = new Map<string, string>();
const askedFiles = new Set<string>();
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
/** While the owner's password is shown, what hides it again. */
let passwordShown: number | undefined;
/** Whether phone access is being turned on or off, which runs every app again. */
let phoneSwitching = false;
/** How many phones were paired at the last state, so the pairing code goes once another pairs. */
let pairedBefore = 0;
let pairingTimer: ReturnType<typeof setTimeout> | undefined;
/** The phone address the QR code shows, so it's drawn again only when that changes. */
let phoneUrlShown: string | undefined;

setUpModels(post, () => render());
setUpStatusbar((tab) => go({ kind: "settings", tab }));
popover(element("show-sign-in"), element("sign-in-popover"));
popover(element("show-phone"), element("phone-popover"));
popover(element("show-share"), element("share-popover"));
setUpPeople(post, () => render(), () => go({ kind: "settings", tab: "people" }));
setUpMail(post, () => render());
// In a narrow window the sidebar is a drawer: the menu button opens it, and Esc, a click elsewhere or going anywhere closes it.
element("show-sidebar").addEventListener("click", () => showSidebar(!document.body.classList.contains("sidebar-open")));
document.addEventListener("keydown", (event) => event.key === "Escape" && showSidebar(false));
document.addEventListener("click", (event) => {
  const target = event.target as Node;
  if (!element("sidebar").contains(target) && !element("show-sidebar").contains(target)) showSidebar(false);
});
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
findBar({
  field: element<HTMLTextAreaElement>("code-text"),
  bar: element("find-bar"),
  find: element<HTMLInputElement>("find-text"),
  count: element("find-count"),
  previous: element("find-previous"),
  next: element("find-next"),
  replace: element<HTMLInputElement>("replace-text"),
  replaceOne: element("replace-one"),
  replaceAll: element("replace-all"),
  close: element("find-close"),
});
const conversationFind = threadFind({
  bar: element("thread-find"),
  find: element<HTMLInputElement>("thread-find-text"),
  count: element("thread-find-count"),
  previous: element("thread-find-previous"),
  next: element("thread-find-next"),
  close: element("thread-find-close"),
  turns: element("turns"),
});
// Ctrl+F or Cmd+F finds in the conversation on screen. The editor has its own.
document.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f" || event.defaultPrevented) return;
  if (view.kind === "settings" || element("turns").hidden) return;
  event.preventDefault();
  conversationFind.open();
});
// The extension notifies about work that ends while the page lacks the focus, as when Podman Desktop is in the background.
window.addEventListener("focus", () => post({ type: "focus", on: true }));
window.addEventListener("blur", () => post({ type: "focus", on: false }));
keyboardTabs(element("app-tabs"));
keyboardTabs(element("settings-tabs"));
const attached = uploads({ input: element<HTMLInputElement>("file-input"), button: element("attach"), list: element("pending-files"), composer: element("composer") }, (why) => showBanner(why, "error"));
const appFilter = element<HTMLInputElement>("app-filter");
appFilter.addEventListener("input", () => state !== undefined && renderSidebar(state));
appFilter.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  element("apps").querySelector<HTMLButtonElement>("button.nav-item")?.click();
});
element("settings-logs").append(settingsLogs.element);
element("ledger").append(ledger.element);
element("app-logs").append(appLogs.element);
element("examples").replaceChildren(...EXAMPLES.map(exampleItem));

window.addEventListener("message", (event: MessageEvent<ToUi>) => receive(event.data));
element("new-app").addEventListener("click", () => go({ kind: "new" }));
element("show-settings").addEventListener("click", () => go({ kind: "settings", tab: "general" }));
for (const tab of SETTINGS_TABS) element(`settings-tab-${tab}`).addEventListener("click", () => go({ kind: "settings", tab }));
element("open-app").addEventListener("click", openApp);
element("add-key").addEventListener("click", () => {
  const model = state === undefined ? undefined : activeModel(state, undefined);
  go({ kind: "settings", tab: "models" });
  openForm(model);
});
element("start-app").addEventListener("click", () => view.kind === "app" && startWork({ type: "start", app: view.name }));
element("tab-chat").addEventListener("click", () => showTab("chat"));
element("tab-history").addEventListener("click", () => showTab("history"));
element("tab-code").addEventListener("click", () => showTab("code"));
element("tab-logs").addEventListener("click", () => showTab("logs"));
element("edit-code").addEventListener("click", () => {
  const app = shownApp();
  const base = app === undefined ? undefined : startingPoint(app);
  if (app !== undefined && base !== undefined) startEditing(app, base.id);
});
element("close-editor").addEventListener("click", () =>
  unlessUnsaved(() => {
    editing = undefined;
    render();
  }),
);
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
element("new-password").addEventListener("click", () => {
  hidePassword();
  makeNewPassword();
});
for (const id of ["show-password", "settings-show-password"]) element(id).addEventListener("click", () => (passwordShown === undefined ? post({ type: "show-password" }) : hidePassword()));
developer.addEventListener("change", () => post({ type: "developer", on: developer.checked }));
element<HTMLInputElement>("autostart").addEventListener("change", (event) => post({ type: "autostart", on: (event.target as HTMLInputElement).checked }));
element<HTMLInputElement>("phone-creation").addEventListener("change", (event) => {
  post({ type: "phone-creation", on: (event.target as HTMLInputElement).checked });
});
element("pair-phone").addEventListener("click", () => post({ type: "pair-phone" }));
element<HTMLInputElement>("phone-access").addEventListener("change", (event) => {
  phoneSwitching = true;
  post({ type: "phone", on: (event.target as HTMLInputElement).checked });
  render();
});

window.setInterval(tickClocks, 1000);
// The lights beside the apps follow what Podman says, asked again every little while the page is in view.
window.setInterval(() => document.visibilityState === "visible" && post({ type: "health" }), HEALTH_MS);
post({ type: "ready" });

function receive(message: ToUi): void {
  switch (message.type) {
    case "state": {
      const saved = savedModel(true);
      savedMail(true);
      receiveState(message);
      // The model saved just now may have a new key, so the doctor tries it again.
      if (saved) askDoctor();
      return;
    }
    case "progress":
      if (state !== undefined) state = { ...state, working: message.working };
      return render();
    case "pairing":
      return showPairing(message);
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
    case "attachment":
      thumbnails.set(message.id, imageUrl(message.mediaType, message.data));
      return render();
    case "renamed":
      return followRename(message.from, message.to);
    case "notice":
      return showBanner(message.text, "notice");
    case "offer-email":
      return offerEmail(message, state?.mail?.from ?? null);
    case "password":
      return message.email === undefined ? showPassword(message.password) : showPersonPassword(message.email, message.password);
    case "error":
      savedModel(false);
      savedMail(false);
      return showError(message.text, message.recorded === true);
  }
}

function receiveState(next: State): void {
  const previous = state;
  const ended = previous !== undefined && previous.working !== null && next.working === null;
  // Asked again when work ends too, or a new or renamed app shows as stopped until the next check.
  if (previous === undefined || ended) post({ type: "health" });
  state = next;
  // Whichever way it went, the state that follows says where phone access and sharing stand.
  phoneSwitching = false;
  settleSharing();
  // Whatever the outcome, an error for it came before this.
  if (ended) lastSent = undefined;
  if (view.kind === "app" && shownApp() === undefined) view = { kind: "new" };
  // The ledger grows when work ends, which sends the state.
  if (view.kind === "settings") post({ type: "ledger" });
  render();
}

function go(next: View): void {
  showSidebar(false);
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
  if (typed.kind === "unknown") return showError(`Unknown command: /${typed.name}. Type / to list commands.`);
  if (typed.kind === "command") return runCommand(typed.command, typed.argument);
  if (state === undefined || state.working !== null) return;
  const files = attached.take();
  lastSent = { app: view.kind === "app" ? view.name : null, request: text, ...(view.kind === "new" && newAppModel !== undefined ? { model: newAppModel } : {}), ...(files.length === 0 ? {} : { files }) };
  request.value = "";
  failed = undefined;
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

/** The owner's password on a line of its own, for reading off and typing on a phone, until shown long enough. */
function showPassword(password: string): void {
  window.clearTimeout(passwordShown);
  passwordShown = window.setTimeout(hidePassword, PASSWORD_SHOWN_MS);
  showingPassword(password);
}

function hidePassword(): void {
  window.clearTimeout(passwordShown);
  passwordShown = undefined;
  showingPassword(undefined);
}

function showingPassword(password: string | undefined): void {
  // Shown, it takes the dots' place.
  for (const dots of document.querySelectorAll<HTMLElement>("[data-password-hidden]")) dots.hidden = password !== undefined;
  for (const card of document.querySelectorAll<HTMLElement>("[data-password-shown]")) {
    card.hidden = password === undefined;
    card.replaceChildren(...(password === undefined ? [] : passwordCard(password)));
  }
  // An open eye to show it, a closed one to hide it. In Settings the row says it's the password, so its button says only what it does.
  const eye = icon(password === undefined ? "eye" : "eye-off");
  element("show-password").replaceChildren(eye, password === undefined ? "Show password" : "Hide password");
  element("settings-show-password").replaceChildren(eye.cloneNode(true), password === undefined ? "Show" : "Hide");
  for (const id of ["show-password", "settings-show-password"]) {
    element(id).setAttribute("aria-label", password === undefined ? "Show password" : "Hide password");
    element(id).setAttribute("aria-pressed", String(password !== undefined));
  }
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
  element("code-caption").textContent = base === undefined ? "No code yet." : `routes.ts · version ${base.id}${base.id === app.head ? ", running" : ", latest attempt"} · by ${base.by.name}`;
  const key = `${app.name}:${base?.id ?? ""}:${code === undefined ? "" : "loaded"}`;
  if (key === codeShown) return;
  codeShown = key;
  element("code-current").replaceChildren(code === undefined ? h("p", "quiet", base === undefined ? "" : "Loading code…") : codeView(code, "listing editable"));
}

/** The editor's version, how its last save went, and what can be done now. */
function renderEditor(app: AppView, from: string): void {
  const version = app.versions.find((kept) => kept.id === from);
  const saving = state?.working?.kind === "save" && state.working.app === app.name;
  const status = version === undefined ? "" : version.id === app.head ? "running now" : version.problem === null ? "passed, not running" : "failed";
  element("editor-base").textContent = `routes.ts · version ${from}${status === "" ? "" : `, ${status}`}`;
  const problem = !saving && version?.problem != null ? [h("p", "", `Version ${from} failed testing. Fix the error and save again.`), h("pre", "problem", version.problem)] : [];
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
  const why = unsaved ? "Save changes before deploying" : version?.problem != null ? "This version failed testing" : version?.id === app.head ? "This version is already running" : "";
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

function showSidebar(open: boolean): void {
  document.body.classList.toggle("sidebar-open", open);
  element("show-sidebar").setAttribute("aria-expanded", String(open));
}

/** Does something that closes the editor or loads other code into it, asking first when that would lose changes not saved yet. */
function unlessUnsaved(then: () => void): void {
  if (editing === undefined || !unsaved) return then();
  const dialog = element<HTMLDialogElement>("discard-dialog");
  dialog.returnValue = "";
  dialog.addEventListener("close", () => dialog.returnValue === "discard" && then(), { once: true });
  dialog.showModal();
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
  const replaces = app.head === null ? ["No version is running."] : ["Replaces version ", versionChip(app.head), " at the same address."];
  element("deploy-note").replaceChildren(...replaces, " It passed its trial when it was made.");
  if (!ready) return void element("deploy-changes").replaceChildren(h("p", "quiet", "Loading code…"));
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
  const typed = request.value.trim();
  if (command.name === "rename") return askToRename(app, argument, typed);
  if (state?.working !== null) return;
  request.value = "";
  if (command.name !== "ask") return startWork({ type: command.name, app }, typed);
  // Files in the composer go with a question, as with a request.
  const files = attached.take();
  startWork({ type: "ask", app, question: argument, ...(files.length === 0 ? {} : { files }) }, typed, files);
}

/** Renames the app only once the person agrees to the redeploy it takes. Until then, the command stays in the composer. */
function askToRename(app: string, to: string, typed: string): void {
  const dialog = element<HTMLDialogElement>("rename-dialog");
  element("rename-title").replaceChildren("Rename ", nameChip(app), " to ", nameChip(to), "?");
  dialog.returnValue = "";
  dialog.addEventListener(
    "close",
    () => {
      if (dialog.returnValue !== "rename") return;
      request.value = "";
      startWork({ type: "rename", app, name: to }, typed);
    },
    { once: true },
  );
  dialog.showModal();
}

/** The page follows a renamed app, before the state with its new name comes: its conversation and its editor stay, and the picked version closes. */
function followRename(from: string, to: string): void {
  if (state !== undefined) state = { ...state, apps: state.apps.map((app) => (app.name === from ? { ...app, name: to } : app)) };
  // The editor keeps what is in it: the versions keep their ids under the new name.
  if (editing?.app === from) editing = { ...editing, app: to };
  if (picked?.app === from) picked = undefined;
  if (view.kind === "app" && view.name === from) go({ ...view, name: to });
  else render();
}

/** Starts work on an app, unless other work is under way. If it fails, the conversation says why, and what was typed for it comes back. */
function startWork(message: Extract<FromUi, { readonly app: string }>, typed = "", files: readonly Upload[] = []): void {
  if (state?.working !== null) return;
  lastSent = { app: message.app, request: typed, ...(files.length === 0 ? {} : { files }) };
  failed = undefined;
  hideBanner();
  post(message);
}

function useModelNamed(label: string): void {
  const model = state?.models.find((known) => known.label.toLowerCase() === label.toLowerCase());
  if (model === undefined) return showError(`Unknown model: ${label}. Type /model to list models.`);
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
    control.textContent = "Reset password";
    return post({ type: "new-password" });
  }
  newPasswordArmed = true;
  control.textContent = "Confirm reset (signs out every device)";
  window.setTimeout(() => {
    newPasswordArmed = false;
    control.textContent = "Reset password";
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
  renderPhoneSetting(state);
  renderPhoneCreation(state);
  if (view.kind === "settings") renderSettings(state, view.tab);
  else renderChat(state, app);
  renderStatusbar(state, app, health);
  renderDeployDialog();
}

function renderPhoneSetting({ phoneHost }: State): void {
  const box = element<HTMLInputElement>("phone-access");
  if (!phoneSwitching) box.checked = phoneHost !== null;
  box.disabled = phoneSwitching;
  element("phone-note").textContent = phoneSwitching
    ? `Turning ${box.checked ? "on" : "off"} phone access…`
    : phoneHost !== null
      ? `Apps are available at ${phoneHost} on your Tailscale network. Turning this off restarts deployed apps.`
      : "Tailscale HTTPS puts this device's name in public certificate logs, but apps stay on your Tailscale network. Turning this on restarts deployed apps.";
}

function renderPhoneCreation({ phoneHost, phoneCreation, phones }: State): void {
  const box = element<HTMLInputElement>("phone-creation");
  box.checked = phoneCreation;
  box.disabled = phoneHost === null;
  const note = element("phone-creation-note");
  if (phoneHost === null) note.replaceChildren("Needs phone access on.");
  else if (!phoneCreation) note.replaceChildren("A page on your phone for making and changing apps, paired with this computer.");
  else note.replaceChildren("Your phone makes and changes apps at ", nameChip(phonePageUrl(phoneHost)), ". It can't see settings, people or passwords, or remove anything. Turning this off forgets every paired phone.");
  element("phone-pairing").hidden = !phoneCreation;
  element("paired-phones").replaceChildren(...phones.map(pairedPhone));
  // The code is spent once a phone pairs with it.
  if (phones.length > pairedBefore) hidePairing();
  pairedBefore = phones.length;
}

function pairedPhone({ id, name, pairedAt }: PhoneView): HTMLLIElement {
  const forget = h("button", "quiet-button", "Forget");
  forget.type = "button";
  forget.addEventListener("click", () => post({ type: "forget-phone", id }));
  return h("li", "paired-phone", h("span", "", name), h("span", "quiet", `Paired ${new Date(pairedAt).toLocaleDateString()}`), forget);
}

/** The pairing code, as a QR code for the phone's camera, until it expires. Never as text: it works once, for whoever has it. */
function showPairing({ url, expires }: { readonly url: string; readonly expires: number }): void {
  element("pairing-qr").replaceChildren(qrCode(url, "QR code to pair a phone"));
  element("pairing").hidden = false;
  clearTimeout(pairingTimer);
  pairingTimer = setTimeout(hidePairing, Math.max(0, expires - Date.now()));
}

function hidePairing(): void {
  element("pairing").hidden = true;
  element("pairing-qr").replaceChildren();
}

/** The app's address on the phone, as a QR code to scan and as text, while phone access is on. */
function renderPhoneDoor(app: AppView | undefined, phoneHost: string | null, unavailable: boolean): void {
  element("phone-anchor").hidden = app === undefined || phoneHost === null;
  element<HTMLButtonElement>("show-phone").disabled = unavailable;
  if (app === undefined || phoneHost === null) return;
  const url = onPhone(app.url, phoneHost);
  if (url === phoneUrlShown) return;
  phoneUrlShown = url;
  element("phone-qr").replaceChildren(qrCode(url, `QR code for ${url}`));
  element("phone-url").textContent = url;
}

function renderSettings(current: State, wanted: SettingsTab): void {
  const tab = current.developer || !DEVELOPER_TABS.includes(wanted) ? wanted : "general";
  for (const name of SETTINGS_TABS) {
    element(`settings-tab-${name}`).hidden = !current.developer && DEVELOPER_TABS.includes(name);
    chooseTab(element(`settings-tab-${name}`), tab === name);
    element(`settings-${name}-tab`).hidden = tab !== name;
  }
  renderModels(current, examination?.models, post, () => render());
  renderPeople(current.people, current.phoneHost !== null, current.mail?.from ?? null);
  renderMail(current.mail, post, () => render());
  element("doctor").replaceChildren(...doctorView(examination?.ready));
  element("health").replaceChildren(...healthView(health));
  ledger.show(calls, { spent: current.spent, apps: current.apps.map((app) => app.name) });
}

function renderSidebar({ apps, working }: State): void {
  // Favourites first, each group in the order the apps were made.
  const ordered = [...apps.filter((app) => app.starred), ...apps.filter((app) => !app.starred)];
  // Past a handful, the apps can be found by name.
  const filter = element<HTMLInputElement>("app-filter");
  filter.hidden = apps.length < FIND_APPS_FROM;
  const wanted = filter.hidden ? "" : filter.value.trim().toLowerCase();
  const shown = ordered.filter((app) => app.name.toLowerCase().includes(wanted));
  element("apps").replaceChildren(...shown.map((app) => appItem(app, lightFor(app, health, working?.app))));
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
  // The light's meaning is part of the app's name for screen readers, as a label inside a button is not read.
  control.setAttribute("aria-label", `${app.name}, ${meaning}`);
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
  openApp.title = app?.head === null ? "No version has been deployed" : "Open in your browser";
  // While Mayfly works on the app, and above all while it removes it, the app is left alone.
  const busy = state.working !== null && state.working.app === (app?.name ?? null);
  const removing = busy && state.working?.kind === "remove";
  element<HTMLButtonElement>("remove-app").disabled = busy;
  if (removing) openApp.disabled = true;
  // A stopped app gets a way to run again; Open app would find nothing there. One still starting would not answer yet.
  const light = app === undefined || busy ? undefined : lightFor(app, health, state.working?.app).colour;
  const stopped = light === "red";
  if (light === "starting") {
    openApp.disabled = true;
    openApp.title = "Starting: it opens once its health check passes";
  }
  element("start-app").hidden = !stopped;
  renderPhoneDoor(app, state.phoneHost, app?.head === null || removing);
  renderShare(app, state.people, state.phoneHost !== null, removing);
  openApp.classList.toggle("primary", !stopped);
  openApp.classList.toggle("secondary", stopped);
  for (const tab of element("app-tabs").querySelectorAll("button")) tab.disabled = removing;
  const failure = failed !== undefined && failed.app === (app?.name ?? null) && working === null ? [turn("mayfly", h("p", "failure", failed.text), SPEAKING)] : [];
  element("welcome").hidden = app !== undefined || working !== null || failure.length > 0;
  // A nudge, not a gate: OpenAI always wants a key, while a compatible endpoint, like a local model, may need none.
  const model = activeModel(state, app);
  element("key-hint").hidden = app !== undefined || model?.provider !== "openai" || model.hasApiKey;
  element("key-hint-text").textContent = `${model?.label ?? "This model"} needs an API key.`;
  const showing = showingFor(state);
  const said = app?.conversation ?? [];
  // The turns are built again only when what they show changes: not on each step of the work, which only the last turns show.
  const key = [app?.name, said.length, said.at(-1)?.at, state.developer, foldsChanged, written.size, app?.versions.length, thumbnails.size].join("|");
  if (builtTurns?.key !== key) builtTurns = { key, items: said.map((turn) => turnItem(turn, SPEAKING, app === undefined ? [] : [...filesOf(app.name, turn, SPEAKING), ...madeOf(turn, app, showing)])) };
  const asked = working === null ? [] : [turnItem({ from: "person", text: working.request, at: working.since }, SPEAKING)];
  const pending = working === null ? failure : [...asked, turn("mayfly", pendingView(working, showing, SPEAKING), SPEAKING)];
  const thread = element("thread");
  const following = thread.scrollHeight - thread.scrollTop - thread.clientHeight < FOLLOW_PX;
  // History and Code are for developers.
  const tab = view.kind !== "app" || !state.developer ? "chat" : view.tab;
  // The editor has its own message box; a second one for the model would only confuse.
  element("composer").hidden = tab === "code" && editing !== undefined && editing.app === app?.name;
  element("turns").hidden = tab !== "chat";
  showTurns(tab === "chat" ? builtTurns : undefined, pending);
  conversationFind.mark();
  element("history").hidden = tab !== "history";
  renderHistory(tab === "history" ? app : undefined, showing, state.working === null);
  for (const name of ["chat", "history", "code", "logs"] as const) chooseTab(element(`tab-${name}`), tab === name);
  element("logs-tab").hidden = tab !== "logs";
  if (tab === "logs" && app !== undefined) renderAppLogs(app);
  else appLogsShown = undefined;
  element("app-tabs").hidden = !state.developer;
  element("code-tab").hidden = tab !== "code";
  if (tab === "code" && app !== undefined) renderCode(app, showing);
  if (following && tab === "chat") scrollToEnd(thread);
  for (const live of document.querySelectorAll<HTMLElement>(".live")) scrollToEnd(live);
  request.placeholder = app === undefined ? "Describe the app you need" : "Ask for a change, or type / for commands";
  request.disabled = removing;
  element<HTMLButtonElement>("send").disabled = state.working !== null;
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
      foldsChanged++;
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
  const actions = idle ? { deploy: (id: string) => askToDeploy(app.name, id), ...(editable ? { edit: (id: string) => unlessUnsaved(() => startEditing(app, id)) } : {}) } : {};
  const compare = {
    with: comparing?.app === app.name && comparing.version === version.id ? comparing.with : undefined,
    choose: (other: string | undefined) => {
      comparing = other === undefined ? undefined : { app: app.name, version: version.id, with: other };
      render();
    },
  };
  panel.replaceChildren(...versionPanel(app, version, showing, { pick: (id) => pick({ app: app.name, version: id }), close: () => pick(undefined), compare, ...actions }));
}

/** Puts the turns in the conversation: all of them when they were built again, or else only the work's, in place of the last ones. */
function showTurns(built: typeof builtTurns, pending: readonly HTMLElement[]): void {
  const list = element("turns");
  if (built === undefined) {
    list.replaceChildren();
    turnsShown = "";
  } else if (turnsShown !== built.key) {
    list.replaceChildren(...built.items, ...pending);
    turnsShown = built.key;
  } else {
    for (const node of pendingShown) node.remove();
    list.append(...pending);
  }
  pendingShown = pending;
}

function thumbnailOf(app: string, id: string): string | undefined {
  if (!thumbnails.has(id) && !askedFiles.has(id)) {
    askedFiles.add(id);
    post({ type: "attachment", app, id });
  }
  return thumbnails.get(id);
}

// A link in a reply opens in the browser, by way of the extension, which opens only web pages.
function openLink(url: string): void {
  post({ type: "open-link", url });
}

function versionChip(id: string): HTMLElement {
  return h("code", "version-id", id);
}

function scrollToEnd(box: HTMLElement): void {
  box.scrollTop = box.scrollHeight;
}

/**
 * Work the person asked for from a conversation fails in that conversation, with what they typed back in the composer. The engine keeps
 * most failures in the app's conversation itself; the rest, like a new app's, the page says there until something else is asked.
 * Anything else, or seen from elsewhere, fails in the banner.
 */
function showError(text: string, recorded = false): void {
  const sent = lastSent;
  lastSent = undefined;
  const conversation = view.kind === "app" ? view.name : null;
  if (sent === undefined || sent.app !== conversation || view.kind === "settings") return showBanner(text, "error");
  if (request.value === "") request.value = sent.request;
  if (sent.files !== undefined) attached.put(sent.files);
  if (recorded) return;
  failed = { app: conversation, text };
  render();
}

function showBanner(text: string, kind: "notice" | "error"): void {
  const banner = element("banner");
  banner.replaceChildren(...withChips(text));
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
