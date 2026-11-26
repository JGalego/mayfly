import type { AppView } from "../../../engine/engine.ts";
import type { Turn } from "../../../engine/state.ts";
import type { Step } from "../../../engine/step.ts";
import type { Usage } from "../../../engine/usage.ts";
import type { FromUi, Progress, ToUi, Work } from "../messages.ts";
import { isProvider, PROVIDERS } from "../settings.ts";

// Podman Desktop puts this function on every webview page, to send messages to the extension.
declare function acquirePodmanDesktopApi(): { postMessage(message: FromUi): void };

type State = Extract<ToUi, { type: "state" }>;
/** What the main area shows: a new app's empty conversation, an app's conversation, or the settings. */
type View = { readonly kind: "new" } | { readonly kind: "app"; readonly name: string } | { readonly kind: "settings" };

const NOTICE_MS = 4000;
const CONFIRM_MS = 4000;
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
let bannerTimer: number | undefined;

provider.replaceChildren(...Object.entries(PROVIDERS).map(([value, label]) => new Option(label, value)));
element("examples").replaceChildren(...EXAMPLES.map(exampleItem));

window.addEventListener("message", (event: MessageEvent<ToUi>) => receive(event.data));
element("new-app").addEventListener("click", () => go({ kind: "new" }));
element("show-settings").addEventListener("click", () => go({ kind: "settings" }));
element("add-key").addEventListener("click", () => go({ kind: "settings" }));
element("open-app").addEventListener("click", openApp);
element("remove-app").addEventListener("click", removeApp);
element("copy-password").addEventListener("click", () => post({ type: "copy-password" }));
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

post({ type: "ready" });

function receive(message: ToUi): void {
  switch (message.type) {
    case "state":
      return receiveState(message);
    case "progress":
      if (state !== undefined) state = { ...state, working: message.working };
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
  if (view.kind !== "settings") request.focus();
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
  markCurrent(element("new-app"), view.kind === "new");
  element("new-app").classList.toggle("working", working?.app === null);
  markCurrent(element("show-settings"), view.kind === "settings");
}

// Built from text nodes only, so nothing in a name or a conversation can become markup.
function appItem(app: AppView, working: boolean): HTMLLIElement {
  const control = document.createElement("button");
  control.type = "button";
  control.className = "nav-item";
  control.textContent = app.name;
  control.classList.toggle("working", working);
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
  element("remove-app").textContent = removeArmed ? "Remove for good?" : "Remove";
  element("remove-app").classList.toggle("armed", removeArmed);
  element("welcome").hidden = app !== undefined || working !== null;
  element("needs-key").hidden = state.hasApiKey;
  element("examples").hidden = !state.hasApiKey;
  const turns = [...(app?.conversation ?? []), ...(working === null ? [] : [{ from: "person", text: working.request } as const])];
  // Behind the curtain, the last reply shows the code running now.
  const lastReply = turns.findLastIndex((turn) => turn.from === "mayfly");
  const items = turns.map((turn, index) => turnItem(turn, app !== undefined && state.peek && index === lastReply ? [codeBlock(app.routes, false)] : []));
  const pending = working === null ? [] : [thinking(working, app === undefined ? "Writing your app" : "Changing your app", state)];
  element("turns").replaceChildren(...items, ...pending);
  request.placeholder = app === undefined ? "Describe the app you need" : `Ask for a change to ${app.name}`;
  request.disabled = !state.hasApiKey;
  element<HTMLButtonElement>("send").disabled = !state.hasApiKey || state.working !== null;
  const thread = element("thread");
  thread.scrollTop = thread.scrollHeight;
}

function turnItem({ from, text }: Turn, extras: readonly Node[] = []): HTMLLIElement {
  const words = document.createElement("p");
  words.textContent = text;
  const body = document.createElement("div");
  body.append(words, ...extras);
  return turn(from, body);
}

function thinking({ steps }: Progress, text: string, { peek, model }: State): HTMLLIElement {
  const words = document.createElement("p");
  words.append(spinner(), text);
  const note = document.createElement("p");
  note.className = "quiet";
  note.textContent = "This takes about a minute.";
  const body = document.createElement("div");
  body.append(words, note);
  if (peek) body.append(stepList(steps, model.model));
  return turn("mayfly", body);
}

function stepList(steps: readonly Step[], model: string): HTMLOListElement {
  const list = document.createElement("ol");
  list.className = "steps";
  const lastCode = steps.findLastIndex((step) => step.kind === "wrote");
  list.append(...steps.map((step, index) => stepItem(step, model, index === lastCode)));
  return list;
}

function stepItem(step: Step, model: string, latestCode: boolean): HTMLLIElement {
  const item = document.createElement("li");
  switch (step.kind) {
    case "writing":
      item.textContent = step.attempt === 1 ? `${model} is writing routes.ts.` : `${model} is fixing it. Attempt ${step.attempt}.`;
      break;
    case "wrote":
      item.append(codeBlock(step.routes, latestCode));
      break;
    case "trying":
      item.textContent = "Building it and trying it, cut off from the network.";
      break;
    case "failed":
      item.append("It failed:", preformatted(step.problem, "problem"));
      break;
    case "deploying":
      item.textContent = "It passed. Starting it behind sign-in.";
      break;
  }
  return item;
}

function codeBlock(routes: string, open: boolean): HTMLDetailsElement {
  const details = document.createElement("details");
  details.className = "code";
  details.open = open;
  const summary = document.createElement("summary");
  summary.textContent = `routes.ts · ${routes.split("\n").length - 1} lines`;
  details.append(summary, preformatted(routes, "listing"));
  return details;
}

function preformatted(text: string, className: string): HTMLPreElement {
  const block = document.createElement("pre");
  block.className = className;
  block.textContent = text;
  return block;
}

function turn(from: Turn["from"], body: HTMLElement): HTMLLIElement {
  const item = document.createElement("li");
  item.className = `turn ${from}`;
  if (from === "mayfly") item.append(avatar());
  item.append(body);
  return item;
}

function spinner(): HTMLSpanElement {
  const shape = document.createElement("span");
  shape.className = "spinner small";
  return shape;
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
  const tokens = element("tokens");
  tokens.textContent = app === undefined ? `${count(spent)} tokens in all` : `${count(app.spent)} tokens on ${app.name} · ${count(spent)} in all`;
  tokens.title = `In all: ${spent.input.toLocaleString()} input, ${spent.output.toLocaleString()} output`;
}

function count(usage: Usage): string {
  return (usage.input + usage.output).toLocaleString();
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
