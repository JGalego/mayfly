import * as api from "@podman-desktop/api";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dexIdentity } from "../../adapters/dex/dex-identity.ts";
import { readJson, writeJson } from "../../adapters/json-file/json-file.ts";
import { jsonFileStore } from "../../adapters/json-file/json-file-store.ts";
import { openAiCompatibleModel } from "../../adapters/openai-compatible/openai-compatible-model.ts";
import { podmanBuilder } from "../../adapters/podman/podman-builder.ts";
import { podmanDeployer, podmanObserver } from "../../adapters/podman/podman.ts";
import { createEngine, type Engine } from "../../engine/engine.ts";
import type { ModelProvider } from "../../engine/ports.ts";
import { createController, type ControllerPorts } from "./controller.ts";
import type { ModelPorts } from "./model-settings.ts";
import { endpointOf, FIRST_MODELS, isProvider, labelOf, modelFor, type Models, type ModelSetting } from "./settings.ts";

// The published, signed runtime this version builds apps on. The README shows how to verify it.
const RUNTIME_IMAGE = "ghcr.io/jgalego/mayfly-runtime@sha256:1d30bd9e46727f4f116861a24851c84c267bd79803f75b040c9d223846bebd05";

type Panel = ReturnType<typeof api.window.createWebviewPanel>;

export async function activate(context: api.ExtensionContext): Promise<void> {
  const keys = keyStore(context.secrets);
  const models = await modelStore(join(context.storagePath, "models.json"));
  const logo = await readFile(api.Uri.joinPath(context.extensionUri, "media", "logo.svg").fsPath, "utf8");
  const engine = createEngine({
    store: jsonFileStore(join(context.storagePath, "state.json")),
    deployer: podmanDeployer,
    observer: podmanObserver,
    identity: dexIdentity(logo),
    models: (id) => configuredModel(modelFor(models.models(), id), keys),
    builder: podmanBuilder(RUNTIME_IMAGE),
  });
  let panel: Panel | undefined;
  const show = async (): Promise<void> => {
    if (panel !== undefined) return panel.reveal();
    panel = await openPanel(context, engine, keys, models);
    panel.onDidDispose(() => (panel = undefined));
  };
  context.subscriptions.push(api.commands.registerCommand("mayfly.open", show));
  await show();
}

async function openPanel(context: api.ExtensionContext, engine: Engine, keys: KeyStore, models: ModelStore): Promise<Panel> {
  const media = api.Uri.joinPath(context.extensionUri, "media");
  const panel = api.window.createWebviewPanel("mayfly", "Mayfly", { localResourceRoots: [media] });
  // The navigation bar shows this file by its path: the same logo as the page, sharp at any size.
  panel.iconPath = api.Uri.joinPath(media, "logo.svg");
  context.subscriptions.push(panel);
  panel.webview.html = await pageFor(panel.webview, media);
  const handle = createController({
    engine,
    post: (message) => panel.webview.postMessage(message),
    openExternal: (url) => api.env.openExternal(api.Uri.parse(url)),
    copy: (text) => api.env.clipboard.writeText(text),
    settings: {
      ...models,
      peek: () => api.configuration.getConfiguration("mayfly").get<boolean>("peek") ?? false,
      savePeek: (on) => api.configuration.getConfiguration("mayfly").update("peek", on),
    },
    keys,
  });
  context.subscriptions.push(panel.webview.onDidReceiveMessage(handle));
  return panel;
}

/** The page from media/, with its files turned into webview URIs and its CSP allowing only them. */
async function pageFor(webview: api.Webview, media: api.Uri): Promise<string> {
  const page = await readFile(api.Uri.joinPath(media, "index.html").fsPath, "utf8");
  return page
    .replaceAll("{{cspSource}}", webview.cspSource)
    .replaceAll(/(src|href)="([\w.-]+)"/g, (_, attribute: string, file: string) => {
      return `${attribute}="${webview.asWebviewUri(api.Uri.joinPath(media, file)).toString()}"`;
    });
}

type KeyStore = ControllerPorts["keys"] & { get(endpoint: string): Promise<string | undefined> };

// Each key is stored under its endpoint, so changing the endpoint never sends a key somewhere it was not given for.
function keyStore(secrets: api.SecretStorage): KeyStore {
  const secretFor = (endpoint: string): string => `mayfly.apiKey ${endpoint}`;
  return {
    get: (endpoint) => secrets.get(secretFor(endpoint)),
    has: async (endpoint) => Boolean(await secrets.get(secretFor(endpoint))),
    save: (endpoint, key) => secrets.store(secretFor(endpoint), key),
  };
}

// The key is read on each call, so a newly saved one works without restarting anything.
function configuredModel(setting: ModelSetting, keys: KeyStore): ModelProvider {
  const name = labelOf(setting);
  return {
    name,
    async complete(system, messages, onText) {
      const baseUrl = endpointOf(setting);
      const apiKey = await keys.get(baseUrl);
      if (!apiKey) throw new Error(`Add the API key for ${name} in Settings first.`);
      return openAiCompatibleModel({ baseUrl, apiKey, model: setting.model }).complete(system, messages, onText);
    },
  };
}

type ModelStore = ModelPorts["settings"];

/** The models, kept in a file beside the state, and in memory so the page always has them at hand. */
async function modelStore(path: string): Promise<ModelStore> {
  let models = ((await readJson(path)) as Models | undefined) ?? modelsFromOldSettings();
  return {
    models: () => models,
    async saveModels(next) {
      models = next;
      await writeJson(path, next);
    },
  };
}

// The model someone chose before Mayfly kept a list of them, from Podman Desktop's settings, becomes the first.
function modelsFromOldSettings(): Models {
  const settings = api.configuration.getConfiguration("mayfly");
  const provider = settings.get<string>("model.provider");
  const model = settings.get<string>("model.name");
  if (!isProvider(provider) || !model) return FIRST_MODELS;
  return { models: [{ id: "first", provider, baseUrl: settings.get<string>("model.baseUrl") ?? "", model }], default: "first" };
}
