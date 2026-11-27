// The phone page: the apps and their conversations, laid out for a phone, talking to the extension over the private network.
import type { ServiceHealth } from "../../../engine/engine.ts";
import type { FromUi, Progress, Upload } from "../messages.ts";
import type { PhoneApp, ToPhone } from "../phone-page.ts";
import { parse } from "../ui/commands.ts";
import { h } from "../ui/dom.ts";
import { addIcons } from "../ui/icons.ts";
import { lightFor } from "../ui/lights.ts";
import { tickClocks, type Showing } from "../ui/progress.ts";
import { filesOf, pendingView, turn, turnItem, type Speaking } from "../ui/turns.ts";
import { imageUrl, uploads } from "../ui/uploads.ts";
import { isPaired, openLink, pair, type Link, type LinkPorts, type LinkStatus } from "./link.ts";
import { fitPhoto } from "./photos.ts";

const PAIRING = /^#pair=([\w-]+)$/;
const HEALTH_MS = 30_000;
const NOTICE_MS = 4000;
// How close to the bottom of a conversation counts as following it.
const FOLLOW_PX = 48;
// The rest need the computer: the phone never takes anything away or changes how Mayfly is set up.
const ON_THE_PHONE = new Set(["ask", "fix", "retry", "undo", "start"]);

const ports: LinkPorts = { fetch: (input, init) => fetch(input, init), storage: localStorage };
const thumbnails = new Map<string, string>();
const asked = new Set<string>();
const folds = new Map<string, boolean>();
const showing: Showing = {
  developer: false,
  isOpen: (key, byDefault) => folds.get(key) ?? byDefault,
  setOpen: (key, open) => void folds.set(key, open),
  code: () => undefined,
  thinking: () => undefined,
};
const speaking: Speaking = { open: (url) => window.open(url, "_blank", "noopener"), thumbnail: thumbnailOf, logo: () => "logo.svg" };

let apps: readonly PhoneApp[] = [];
let working: Progress | null = null;
let health: readonly ServiceHealth[] | undefined;
/** The app whose conversation is open, or null for the list of apps. */
let shown: string | null = null;
/** Whether this phone asked for a new app, which it then opens once made. */
let creating = false;
let link: Link | undefined;

const attached = uploads({ input: element("file-input"), button: element("attach"), list: element("pending-files"), composer: element("composer") }, (why) => notify(why, true), fitPhoto);

addIcons(document.body);
element("back").addEventListener("click", () => show(null));
element("composer").addEventListener("submit", (event) => {
  event.preventDefault();
  void submit();
});
// Offline, the page still opens from what the service worker kept, and says so.
void navigator.serviceWorker?.register("sw.js");
void start();

async function start(): Promise<void> {
  const code = PAIRING.exec(location.hash)?.[1];
  if (code !== undefined) {
    // Off the address at once: the code works once, and should stay in no history or bookmark.
    history.replaceState(null, "", location.pathname);
    try {
      await pair(code, ports);
    } catch (error) {
      return unpaired(messageOf(error));
    }
  }
  if (!isPaired(ports)) return unpaired("Pair this phone first: in Mayfly on the computer, open Settings, turn on Make apps from my phone, and scan the code with the phone's camera.");
  link = openLink(ports, hear, status);
  // A phone puts a page to sleep without closing its stream, so it connects again on waking.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") link?.wake();
  });
  setInterval(() => {
    if (document.visibilityState === "visible") void send({ type: "health" });
  }, HEALTH_MS);
  setInterval(tickClocks, 1000);
}

function hear(message: ToPhone): void {
  switch (message.type) {
    case "state":
      apps = message.apps;
      working = message.working;
      if (!apps.some((app) => app.name === shown)) shown = null;
      return render();
    case "progress":
      working = message.working;
      return render();
    case "created":
      if (creating) shown = message.name;
      creating = false;
      return render();
    case "renamed":
      if (shown === message.from) shown = message.to;
      return render();
    case "attachment":
      thumbnails.set(message.id, imageUrl(message.mediaType, message.data));
      return render();
    case "health":
      health = message.services;
      return render();
    case "notice":
      return notify(message.text, false);
    case "error":
      creating = false;
      return notify(message.text, true);
  }
}

function status(now: LinkStatus): void {
  if (now === "unpaired") return unpaired("This phone isn't paired anymore. To pair it again, scan the code in Mayfly's Settings on the computer.");
  const line = element("link-status");
  line.hidden = now === "online";
  line.textContent = now === "connecting" ? "Connecting to Mayfly…" : "Can't reach Mayfly. Is the computer awake, with Podman Desktop open?";
  element("send").toggleAttribute("disabled", now !== "online");
  if (now === "online") void send({ type: "health" });
}

function unpaired(why: string): void {
  element("unpaired-text").textContent = why;
  for (const id of ["home", "chat", "composer", "link-status"]) element(id).hidden = true;
  element("unpaired").hidden = false;
}

function show(app: string | null): void {
  shown = app;
  render();
  element("chat").scrollTop = element("chat").scrollHeight;
}

function render(): void {
  const app = apps.find((candidate) => candidate.name === shown);
  element("unpaired").hidden = true;
  element("composer").hidden = false;
  element("back").hidden = app === undefined;
  element("title").textContent = app?.name ?? "Mayfly";
  const open = element<HTMLAnchorElement>("open-app");
  // Only an app with a version running has anything to open.
  open.hidden = app?.head == null;
  if (app !== undefined) open.href = app.url;
  element("home").hidden = app !== undefined;
  element("chat").hidden = app === undefined;
  element<HTMLTextAreaElement>("request").placeholder = app === undefined ? "Describe an app to make" : "Ask for a change, or /ask a question";
  if (app === undefined) renderHome();
  else renderChat(app);
}

function renderHome(): void {
  const making = working !== null && working.app === null ? [...askedTurn(working), turn("mayfly", pendingView(working, showing, speaking), speaking)] : [];
  element("making").replaceChildren(...making);
  element("phone-apps").replaceChildren(...apps.map(appRow));
  element("no-apps").hidden = apps.length > 0 || making.length > 0;
}

function appRow(app: PhoneApp): HTMLLIElement {
  const light = lightFor(app, health, working?.app);
  const dot = h("span", `light ${light.colour}`);
  dot.title = light.meaning;
  dot.setAttribute("role", "img");
  dot.setAttribute("aria-label", light.meaning);
  const row = h("button", "app-row", dot, h("span", "app-name", app.name));
  row.type = "button";
  row.addEventListener("click", () => show(app.name));
  return h("li", "", row);
}

function renderChat(app: PhoneApp): void {
  const box = element("chat");
  const following = box.scrollHeight - box.scrollTop - box.clientHeight < FOLLOW_PX;
  const said = app.conversation.map((turnSaid) => turnItem(turnSaid, speaking, filesOf(app.name, turnSaid, speaking)));
  const pending = working?.app === app.name ? [...askedTurn(working), turn("mayfly", pendingView(working, showing, speaking), speaking)] : [];
  element("turns").replaceChildren(...said, ...pending);
  if (following) box.scrollTop = box.scrollHeight;
}

// What the person asked for shows at once, as the tab shows it, before Mayfly's reply.
function askedTurn(work: Progress): HTMLLIElement[] {
  return [turnItem({ from: "person", text: work.request, at: work.since }, speaking)];
}

async function submit(): Promise<void> {
  const box = element<HTMLTextAreaElement>("request");
  const files = attached.take();
  const message = messageFor(box.value.trim(), files);
  if (message === undefined) return attached.put(files);
  try {
    creating = message.type === "send" && message.app === null;
    await send(message);
    box.value = "";
  } catch (error) {
    creating = false;
    attached.put(files);
    notify(messageOf(error), true);
  }
}

/** The message for what the person typed, or undefined, having said why, when the phone can't send it. */
function messageFor(text: string, files: readonly Upload[]): FromUi | undefined {
  const typed = parse(text);
  const withFiles = files.length === 0 ? {} : { files };
  if (typed.kind === "request") return text === "" && files.length === 0 ? undefined : { type: "send", app: shown, request: text, ...withFiles };
  if (typed.kind === "unknown") return void notify(`Mayfly doesn't know /${typed.name}.`, true);
  const { name } = typed.command;
  if (!ON_THE_PHONE.has(name)) return void notify(`Use /${name} in Mayfly on the computer.`, true);
  if (shown === null) return void notify(`Open an app first, then use /${name}.`, true);
  if (name === "ask") return { type: "ask", app: shown, question: typed.argument, ...withFiles };
  return { type: name as "fix" | "retry" | "undo" | "start", app: shown };
}

async function send(message: FromUi): Promise<void> {
  if (link === undefined) return;
  await link.send(message);
}

function thumbnailOf(app: string, id: string): string | undefined {
  if (!thumbnails.has(id) && !asked.has(id)) {
    asked.add(id);
    void send({ type: "attachment", app, id });
  }
  return thumbnails.get(id);
}

function notify(text: string, failed: boolean): void {
  const toast = element("toast");
  toast.textContent = text;
  toast.classList.toggle("failure", failed);
  toast.hidden = false;
  setTimeout(() => (toast.hidden = true), NOTICE_MS);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`The page has no #${id}.`);
  return found as T;
}
