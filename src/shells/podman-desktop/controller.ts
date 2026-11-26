import type { Engine } from "../../engine/engine.ts";
import type { FromUi, ToUi, Work } from "./messages.ts";
import { endpointOf, isProvider, type ModelChoice } from "./settings.ts";

const MAX_REQUEST = 2000;
const MAX_MODEL_NAME = 200;

export interface ControllerPorts {
  readonly engine: Engine;
  readonly post: (message: ToUi) => Promise<unknown>;
  readonly openExternal: (url: string) => Promise<unknown>;
  readonly copy: (text: string) => Promise<unknown>;
  readonly settings: { read(): ModelChoice; save(choice: ModelChoice): Promise<void> };
  /** API keys, each kept for the endpoint it was given for. */
  readonly keys: { has(endpoint: string): Promise<boolean>; save(endpoint: string, key: string): Promise<void> };
}

// One request at a time: each one reads and writes the whole state.
type Session = ControllerPorts & { working: Work | null };

/** Handles what the page asks for. The page is trusted with nothing: it names apps, never URLs, and never sees a secret. */
export function createController(ports: ControllerPorts): (message: unknown) => Promise<void> {
  const session: Session = { ...ports, working: null };
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
    case "copy-password":
      return copyPassword(session);
    case "save-settings":
      return saveSettings(request.choice, request.apiKey.trim(), session);
  }
}

async function send(work: Work, session: Session): Promise<void> {
  const problem = problemWithWork(work, session);
  if (problem !== undefined) return void (await session.post({ type: "error", text: problem }));
  session.working = work;
  await showState(session);
  const { engine } = session;
  const app = await (work.app === null ? engine.create(work.request) : engine.change(work.app, work.request)).finally(() => {
    session.working = null;
  });
  await showState(session);
  if (work.app !== null) return;
  await session.post({ type: "created", name: app.name });
  await session.openExternal(app.url);
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

async function copyPassword(session: Session): Promise<void> {
  await session.copy((await session.engine.owner()).password);
  await session.post({ type: "notice", text: "Password copied. Paste it when your app asks you to sign in." });
}

async function saveSettings(choice: ModelChoice, apiKey: string, session: Session): Promise<void> {
  const cleaned = { ...choice, baseUrl: choice.baseUrl.trim(), model: choice.model.trim() };
  const problem = problemWithChoice(cleaned);
  if (problem !== undefined) return void (await session.post({ type: "error", text: problem }));
  await session.settings.save(cleaned);
  if (apiKey !== "") await session.keys.save(endpointOf(cleaned), apiKey);
  await session.post({ type: "notice", text: "Saved." });
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
  const model = session.settings.read();
  await session.post({
    type: "state",
    apps: await session.engine.list(),
    owner: (await session.engine.owner()).email,
    model,
    hasApiKey: await session.keys.has(endpointOf(model)),
    spent: await session.engine.spent(),
    working: session.working,
  });
}

// Messages come from the page, so each is checked for its shape before anything acts on it.
function readRequest(message: unknown): FromUi | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const { type, app, request, name, choice, apiKey } = message as Record<string, unknown>;
  switch (type) {
    case "ready":
    case "copy-password":
      return { type };
    case "send":
      return (typeof app === "string" || app === null) && typeof request === "string" ? { type, app, request } : undefined;
    case "open":
    case "remove":
      return typeof name === "string" ? { type, name } : undefined;
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
