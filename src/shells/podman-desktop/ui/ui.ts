import type { AppView } from "../../../engine/engine.ts";
import type { Turn } from "../../../engine/state.ts";
import type { Usage } from "../../../engine/usage.ts";
import type { FromUi, ToUi, Work } from "../messages.ts";
import { isProvider, PROVIDERS } from "../settings.ts";
import { h, keepTime } from "./dom.ts";
import { makingOf, progressView, tickClocks, whatChanged, type Showing } from "./progress.ts";

// Podman Desktop puts this function on every webview page, to send messages to the extension.
declare function acquirePodmanDesktopApi(): { postMessage(message: FromUi): void };

type State = Extract<ToUi, { type: "state" }>;
/** What the main area shows: a new app's empty conversation, an app's conversation, or the settings. */
type View = { readonly kind: "new" } | { readonly kind: "app"; readonly name: string } | { readonly kind: "settings" };

const NOTICE_MS = 4000;
const CONFIRM_MS = 4000;
const COPIED_MS = 1500;
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
const provider = element<HTMLSelectElement>("provider");
const endpoint = element<HTMLInputElement>("endpoint");
const modelName = element<HTMLInputElement>("model-name");
const apiKey = element<HTMLInputElement>("api-key");
const peek = element<HTMLInputElement>("peek");

let state: State | undefined;
let view: View = { kind: "new" };
/** Unsent text, kept for each conversation. */
const drafts = new Map<string, string>();
/** What the person sent last, to give back if it fails. */
let lastSent: Work | undefined;
let removeArmed = false;
/** Folds the person opened or closed, so a redraw leaves them as they were. */
const folds = new Map<string, boolean>();
/** Versions' code fetched from the extension, and the ones already asked for. */
const codes = new Map<string, string>();
const asked = new Set<string>();
let bannerTimer: number | undefined;

provider.replaceChildren(...Object.entries(PROVIDERS).map(([value, label]) => new Option(label, value)));
element("examples").replaceChildren(...EXAMPLES.map(exampleItem));

window.addEventListener("message", (event: MessageEvent<ToUi>) => receive(event.data));
element("new-app").addEventListener("click", () => go({ kind: "new" }));
element("show-settings").addEventListener("click", () => go({ kind: "settings" }));
element("add-key").addEventListener("click", () => go({ kind: "settings" }));
element("open-app").addEventListener("click", openApp);
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
element("settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  saveSettings();
});
provider.addEventListener("change", showEndpointField);
peek.addEventListener("change", () => post({ type: "peek", on: peek.checked }));

window.setInterval(tickClocks, 1000);
post({ type: "ready" });

function receive(message: ToUi): void {
  switch (message.type) {
    case "state":
      return receiveState(message);
    case "progress":
      if (state !== undefined) state = { ...state, working: message.working };
      return render();
    case "code":
      codes.set(`${message.app}:${message.version}`, message.routes);
      return render();
    case "created":
      if (view.kind === "new") go({ kind: "app", name: message.name });
      return;
    case "notice":
      return showBanner(message.text, "notice");
    case "error":
      return showError(message.text);
  }
}

function receiveState(next: State): void {
  const previous = state;
  state = next;
  // Whatever the outcome, an error for it came before this.
  if (previous !== undefined && previous.working !== null && next.working === null) lastSent = undefined;
  if (view.kind === "app" && shownApp() === undefined) view = { kind: "new" };
  if (previous === undefined && !next.hasApiKey) return go({ kind: "settings" });
  if (previous?.hasApiKey === false && next.hasApiKey && view.kind === "settings") return go({ kind: "new" });
  render();
}

function go(next: View): void {
  drafts.set(draftKey(view), request.value);
  view = next;
  request.value = drafts.get(draftKey(view)) ?? "";
  removeArmed = false;
  hideBanner();
  if (view.kind === "settings") fillSettings();
  render();
  if (view.kind === "settings") return;
  request.focus();
  scrollToEnd(element("thread"));
}

function send(): void {
  const text = request.value.trim();
  if (text === "" || view.kind === "settings" || state?.working !== null || !state.hasApiKey) return;
  lastSent = { app: view.kind === "app" ? view.name : null, request: text };
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

function openApp(): void {
  if (view.kind === "app") post({ type: "open", name: view.name });
}

// Removing an app loses its conversation, so it takes a second click.
function removeApp(): void {
  if (view.kind !== "app") return;
  if (removeArmed) return post({ type: "remove", name: view.name });
  removeArmed = true;
  render();
  window.setTimeout(() => {
    removeArmed = false;
    render();
  }, CONFIRM_MS);
}

function saveSettings(): void {
  if (!isProvider(provider.value)) return;
  post({ type: "save-settings", choice: { provider: provider.value, baseUrl: endpoint.value, model: modelName.value }, apiKey: apiKey.value });
  apiKey.value = "";
}

function fillSettings(): void {
  if (state === undefined) return;
  provider.value = state.model.provider;
  endpoint.value = state.model.baseUrl;
  modelName.value = state.model.model;
  apiKey.value = "";
  showEndpointField();
}

function showEndpointField(): void {
  const compatible = provider.value === "openai-compatible";
  for (const field of document.querySelectorAll<HTMLElement>(".compatible-only")) field.hidden = !compatible;
  endpoint.required = compatible;
}

function render(): void {
  if (state === undefined) return;
  const app = shownApp();
  element("loading").hidden = true;
  renderSidebar(state);
  element("chat").hidden = view.kind === "settings";
  element("settings").hidden = view.kind !== "settings";
  apiKey.placeholder = state.hasApiKey ? "Saved. Paste a new key to replace it." : "Paste your API key";
  peek.checked = state.peek;
  if (view.kind !== "settings") renderChat(state, app);
  renderStatusbar(state, app);
}

function renderSidebar({ apps, working }: State): void {
  element("apps").replaceChildren(...apps.map((app) => appItem(app, working?.app === app.name)));
  element("apps-heading").hidden = apps.length === 0;
  const newApp = element("new-app");
  markCurrent(newApp, view.kind === "new");
  newApp.querySelector(".spinner")?.remove();
  if (working?.app === null) newApp.append(spinner());
  markCurrent(element("show-settings"), view.kind === "settings");
}

// Built from text nodes only, so nothing in a name or a conversation can become markup.
function appItem(app: AppView, working: boolean): HTMLLIElement {
  const control = document.createElement("button");
  control.type = "button";
  control.className = "nav-item";
  control.textContent = app.name;
  if (working) control.append(spinner());
  markCurrent(control, view.kind === "app" && view.name === app.name);
  control.addEventListener("click", () => go({ kind: "app", name: app.name }));
  const item = document.createElement("li");
  item.append(control);
  return item;
}

function renderChat(state: State, app: AppView | undefined): void {
  const working = state.working?.app === (app?.name ?? null) ? state.working : null;
  element("app-header").hidden = app === undefined;
  element("owner").textContent = state.owner;
  element("app-name").textContent = app?.name ?? "";
  const openApp = element<HTMLButtonElement>("open-app");
  openApp.disabled = app?.head === null;
  openApp.title = app?.head === null ? "No attempt has passed yet, so nothing is running." : "";
  element("remove-app").textContent = removeArmed ? "Remove for good?" : "Remove";
  element("remove-app").classList.toggle("armed", removeArmed);
  element("welcome").hidden = app !== undefined || working !== null;
  element("needs-key").hidden = state.hasApiKey;
  element("examples").hidden = !state.hasApiKey;
  const turns = [...(app?.conversation ?? []), ...(working === null ? [] : [{ from: "person", text: working.request } as const])];
  const showing = showingFor(state);
  const items = turns.map((said) => turnItem(said, app === undefined ? [] : madeOf(said, app, showing)));
  const pending = working === null ? [] : [turn("mayfly", progressView(working, app === undefined ? "Writing your app" : "Changing your app", showing))];
  const thread = element("thread");
  const following = thread.scrollHeight - thread.scrollTop - thread.clientHeight < FOLLOW_PX;
  element("turns").replaceChildren(...items, ...pending);
  if (following) scrollToEnd(thread);
  for (const live of document.querySelectorAll<HTMLElement>(".live")) scrollToEnd(live);
  request.placeholder = app === undefined ? "Describe the app you need" : `Ask for a change to ${app.name}`;
  request.disabled = !state.hasApiKey;
  element<HTMLButtonElement>("send").disabled = !state.hasApiKey || state.working !== null;
}

/** Under each of Mayfly's replies, how it was made. */
function madeOf(said: Turn, app: AppView, showing: Showing): Node[] {
  if (said.from !== "mayfly" || said.versions.length === 0) return [];
  const versions = said.versions.flatMap((id) => app.versions.find((version) => version.id === id) ?? []);
  const made = makingOf(app.name, versions, said.took, showing);
  const [first, last] = [versions[0], versions.at(-1)];
  const changed = showing.peek && first?.parent != null && last?.problem === null;
  return changed ? [whatChanged(app.name, first.parent, last.id, showing), made] : [made];
}

function showingFor({ peek }: State): Showing {
  return {
    peek,
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

function turnItem({ from, text }: Turn, extras: readonly Node[] = []): HTMLLIElement {
  const words = document.createElement("p");
  words.textContent = text;
  const body = document.createElement("div");
  body.append(words, ...extras);
  return turn(from, body);
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

function renderStatusbar({ model, hasApiKey, spent }: State, app: AppView | undefined): void {
  element("model-info").textContent = [PROVIDERS[model.provider], model.model, ...(hasApiKey ? [] : ["no API key"])].join(" · ");
  const all = `All apps: ${tokens(spent)}`;
  element("tokens").textContent = app === undefined ? all : `${app.name}: ${tokens(app.spent)} · ${all}`;
}

function tokens({ input, output }: Usage): string {
  return `${input.toLocaleString()} tokens in, ${output.toLocaleString()} out`;
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
