import type { Engine } from "../../engine/engine.ts";
import type { Step } from "../../engine/step.ts";
import type { FromUi, Progress, ToUi, Work } from "./messages.ts";
import { endpointOf, isProvider, type ModelChoice } from "./settings.ts";

const MAX_REQUEST = 2000;
const MAX_MODEL_NAME = 200;
// The model's draft changes many times a second. The page gets the latest at most this often.
const DRAFT_MS = 150;

export interface ControllerPorts {
  readonly engine: Engine;
  readonly post: (message: ToUi) => Promise<unknown>;
  readonly openExternal: (url: string) => Promise<unknown>;
  readonly copy: (text: string) => Promise<unknown>;
  readonly settings: {
    model(): ModelChoice;
    saveModel(choice: ModelChoice): Promise<void>;
    peek(): boolean;
    savePeek(on: boolean): Promise<void>;
  };
  /** API keys, each kept for the endpoint it was given for. */
  readonly keys: { has(endpoint: string): Promise<boolean>; save(endpoint: string, key: string): Promise<void> };
}

// One request at a time: each one reads and writes the whole state.
type Session = ControllerPorts & { working: Progress | null; draftDue: boolean };

/** Handles what the page asks for. The page is trusted with nothing: it names apps, never URLs, and never sees a secret. */
export function createController(ports: ControllerPorts): (message: unknown) => Promise<void> {
  const session: Session = { ...ports, working: null, draftDue: false };
  return async (message) => {
    const request = readRequest(message);
    if (request === undefined) return;
    try {
      await handle(request, session);
    } catch (error) {
      await ports.post({ type: "error", text: error instanceof Error ? error.message : String(error) });
      await showState(session);
    }
  };
}

function handle(request: FromUi, session: Session): Promise<unknown> {
  switch (request.type) {
    case "ready":
      return showState(session);
    case "send":
      return send({ app: request.app, request: request.request.trim() }, session);
    case "open":
      return open(request.name, session);
    case "remove":
      return remove(request.name, session);
    case "copy":
      return copySignIn(request.what, session);
    case "save-settings":
      return saveSettings(request.choice, request.apiKey.trim(), session);
    case "peek":
      return savePeek(request.on, session);
    case "code":
      return sendCode(request.app, request.version, session);
  }
}

async function send(work: Work, session: Session): Promise<void> {
  const problem = problemWithWork(work, session);
  if (problem !== undefined) return void (await session.post({ type: "error", text: problem }));
  session.working = { ...work, since: Date.now(), steps: [] };
  await showState(session);
  const { engine } = session;
  const watch = (step: Step): void => showProgress(step, session);
  const app = await (work.app === null ? engine.create(work.request, watch) : engine.change(work.app, work.request, watch)).finally(() => {
    session.working = null;
  });
  await showState(session);
  if (work.app !== null) return;
  await session.post({ type: "created", name: app.name });
  if (app.head !== null) await session.openExternal(app.url);
}

function showProgress(step: Step, session: Session): void {
  if (session.working === null) return;
  session.working = { ...session.working, steps: withStep(session.working.steps, step) };
  if (step.kind !== "draft") return postProgress(session);
  // Only someone peeking sees the draft, and they see it a few times a second rather than on every word.
  if (session.draftDue || !session.settings.peek()) return;
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
  if (session.working !== null) return "Mayfly is still working on your last request. Wait for it to finish.";
  if (work.request === "") return "Say what you need first.";
  if (work.request.length > MAX_REQUEST) return `Keep it under ${MAX_REQUEST} characters.`;
  return undefined;
}

async function open(name: string, session: Session): Promise<void> {
  const app = (await session.engine.list()).find((candidate) => candidate.name === name);
  if (app !== undefined) await session.openExternal(app.url);
}

async function remove(name: string, session: Session): Promise<void> {
  if (session.working !== null) return void (await session.post({ type: "error", text: "Wait for Mayfly to finish first." }));
  await session.engine.remove(name);
  await showState(session);
}

// The page shows that it copied. The password itself never goes to the page.
async function copySignIn(what: "email" | "password", session: Session): Promise<void> {
  await session.copy((await session.engine.owner())[what]);
}

async function saveSettings(choice: ModelChoice, apiKey: string, session: Session): Promise<void> {
  const cleaned = { ...choice, baseUrl: choice.baseUrl.trim(), model: choice.model.trim() };
  const problem = problemWithChoice(cleaned);
  if (problem !== undefined) return void (await session.post({ type: "error", text: problem }));
  await session.settings.saveModel(cleaned);
  if (apiKey !== "") await session.keys.save(endpointOf(cleaned), apiKey);
  await session.post({ type: "notice", text: "Saved." });
  await showState(session);
}

async function sendCode(app: string, version: string, session: Session): Promise<void> {
  await session.post({ type: "code", app, version, routes: await session.engine.code(app, version) });
}

async function savePeek(on: boolean, session: Session): Promise<void> {
  await session.settings.savePeek(on);
  await showState(session);
}

function problemWithChoice({ provider, baseUrl, model }: ModelChoice): string | undefined {
  if (provider === "openai-compatible" && !isWebUrl(baseUrl)) return "Give the endpoint as a URL, such as http://localhost:11434/v1.";
  if (model === "") return "Name the model to use.";
  if (model.length > MAX_MODEL_NAME) return `Keep the model's name under ${MAX_MODEL_NAME} characters.`;
  return undefined;
}

function isWebUrl(text: string): boolean {
  return URL.canParse(text) && ["http:", "https:"].includes(new URL(text).protocol);
}

async function showState(session: Session): Promise<void> {
  const model = session.settings.model();
  await session.post({
    type: "state",
    apps: await session.engine.list(),
    owner: (await session.engine.owner()).email,
    model,
    hasApiKey: await session.keys.has(endpointOf(model)),
    spent: await session.engine.spent(),
    working: session.working,
    peek: session.settings.peek(),
  });
}

// Messages come from the page, so each is checked for its shape before anything acts on it.
function readRequest(message: unknown): FromUi | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const { type, app, request, name, choice, apiKey, on, version, what } = message as Record<string, unknown>;
  switch (type) {
    case "ready":
      return { type };
    case "copy":
      return what === "email" || what === "password" ? { type, what } : undefined;
    case "send":
      return (typeof app === "string" || app === null) && typeof request === "string" ? { type, app, request } : undefined;
    case "open":
    case "remove":
      return typeof name === "string" ? { type, name } : undefined;
    case "peek":
      return typeof on === "boolean" ? { type, on } : undefined;
    case "code":
      return typeof app === "string" && typeof version === "string" ? { type, app, version } : undefined;
    case "save-settings": {
      const model = readChoice(choice);
      return model !== undefined && typeof apiKey === "string" ? { type, choice: model, apiKey } : undefined;
    }
    default:
      return undefined;
  }
}

function readChoice(value: unknown): ModelChoice | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { provider, baseUrl, model } = value as Record<string, unknown>;
  return isProvider(provider) && typeof baseUrl === "string" && typeof model === "string" ? { provider, baseUrl, model } : undefined;
}
