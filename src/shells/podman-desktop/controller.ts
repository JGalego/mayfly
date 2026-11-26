import type { Engine } from "../../engine/engine.ts";
import type { FromUi, ToUi } from "./messages.ts";

const MAX_DESCRIPTION = 2000;

export interface ControllerPorts {
  readonly engine: Engine;
  readonly post: (message: ToUi) => Promise<unknown>;
  readonly openExternal: (url: string) => Promise<unknown>;
  readonly copy: (text: string) => Promise<unknown>;
  readonly apiKey: { isSet(): Promise<boolean>; save(key: string): Promise<void> };
  readonly modelName: () => string;
}

/** Handles what the page asks for. The page is trusted with nothing: it names apps, never URLs, and never sees a secret. */
export function createController(ports: ControllerPorts): (message: unknown) => Promise<void> {
  return async (message) => {
    const request = readRequest(message);
    if (request === undefined) return;
    try {
      await handle(request, ports);
    } catch (error) {
      await ports.post({ type: "error", text: error instanceof Error ? error.message : String(error) });
      await showState(ports);
    }
  };
}

function handle(request: FromUi, ports: ControllerPorts): Promise<unknown> {
  switch (request.type) {
    case "ready":
      return showState(ports);
    case "create":
      return create(request.description.trim(), ports);
    case "open":
      return open(request.name, ports);
    case "remove":
      return remove(request.name, ports);
    case "copy-password":
      return copyPassword(ports);
    case "save-api-key":
      return saveApiKey(request.apiKey.trim(), ports);
  }
}

async function create(description: string, ports: ControllerPorts): Promise<void> {
  if (description === "") return void (await ports.post({ type: "error", text: "Describe the app you need first." }));
  if (description.length > MAX_DESCRIPTION) {
    return void (await ports.post({ type: "error", text: `Keep the description under ${MAX_DESCRIPTION} characters.` }));
  }
  await ports.post({ type: "busy", text: "Making your app. This takes about a minute." });
  const app = await ports.engine.create(description);
  await showState(ports);
  await ports.openExternal(app.url);
}

async function open(name: string, ports: ControllerPorts): Promise<void> {
  const app = (await ports.engine.list()).find((candidate) => candidate.name === name);
  if (app !== undefined) await ports.openExternal(app.url);
}

async function remove(name: string, ports: ControllerPorts): Promise<void> {
  await ports.engine.remove(name);
  await showState(ports);
}

async function copyPassword(ports: ControllerPorts): Promise<void> {
  await ports.copy((await ports.engine.owner()).password);
  await ports.post({ type: "notice", text: "Password copied. Paste it when your app asks you to sign in." });
}

async function saveApiKey(apiKey: string, ports: ControllerPorts): Promise<void> {
  if (apiKey === "") return void (await ports.post({ type: "error", text: "Paste your API key first." }));
  await ports.apiKey.save(apiKey);
  await showState(ports);
}

async function showState({ engine, apiKey, modelName, post }: ControllerPorts): Promise<void> {
  await post({
    type: "state",
    apps: await engine.list(),
    owner: (await engine.owner()).email,
    hasApiKey: await apiKey.isSet(),
    model: modelName(),
  });
}

// Messages come from the page, so each is checked for its shape before anything acts on it.
function readRequest(message: unknown): FromUi | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const { type, description, name, apiKey } = message as Record<string, unknown>;
  switch (type) {
    case "ready":
    case "copy-password":
      return { type };
    case "create":
      return typeof description === "string" ? { type, description } : undefined;
    case "open":
    case "remove":
      return typeof name === "string" ? { type, name } : undefined;
    case "save-api-key":
      return typeof apiKey === "string" ? { type, apiKey } : undefined;
    default:
      return undefined;
  }
}
