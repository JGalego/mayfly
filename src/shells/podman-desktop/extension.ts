import * as api from "@podman-desktop/api";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dexIdentity } from "../../adapters/dex/dex-identity.ts";
import { readJson, writeJson } from "../../adapters/json-file/json-file.ts";
import { jsonFileStore } from "../../adapters/json-file/json-file-store.ts";
import { KeyNeeded, listModels, openAiCompatibleModel } from "../../adapters/openai-compatible/openai-compatible-model.ts";
import { podmanBuilder } from "../../adapters/podman/podman-builder.ts";
import { imageExists, podmanDeployer, podmanObserver, versions } from "../../adapters/podman/podman.ts";
import { createEngine, type Engine } from "../../engine/engine.ts";
import type { ModelProvider } from "../../engine/ports.ts";
import { createController, type ControllerPorts } from "./controller.ts";
import { examine, type ModelProbe } from "./doctor.ts";
import type { ModelPorts } from "./model-settings.ts";
import { endpointOf, FIRST_MODELS, isProvider, labelOf, modelFor, providerOf, type Models, type ModelSetting } from "./settings.ts";

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
  let handle: Handler = async () => {};
  const show = async (): Promise<void> => {
    if (panel !== undefined) return panel.reveal();
    ({ panel, handle } = await openPanel(context, engine, keys, models));
    panel.onDidDispose(() => (panel = undefined));
  };
  context.subscriptions.push(api.commands.registerCommand("mayfly.open", show));
  await show();
  if (settings().get<boolean>("autostart") === true) whenPodmanAnswers(context, () => void handle({ type: "start-stopped" }));
}

type Handler = ReturnType<typeof createController>;

/** Does something once Podman answers: now, or when Podman Desktop next reports a container connection started, as its machine boots. */
function whenPodmanAnswers(context: api.ExtensionContext, act: () => void): void {
  void versions().then((found) => {
    if (found?.server != null) return act();
    const listening = api.provider.onDidUpdateContainerConnection((event) => {
      if (event.status !== "started") return;
      listening.dispose();
      act();
    });
    context.subscriptions.push(listening);
  });
}

async function openPanel(context: api.ExtensionContext, engine: Engine, keys: KeyStore, models: ModelStore): Promise<{ panel: Panel; handle: Handler }> {
  const media = api.Uri.joinPath(context.extensionUri, "media");
  const panel = api.window.createWebviewPanel("mayfly", "Mayfly", { localResourceRoots: [media] });
  // The navigation bar shows this file by its path: the same logo as the page, sharp at any size.
  panel.iconPath = api.Uri.joinPath(media, "logo.svg");
  context.subscriptions.push(panel);
  panel.webview.html = await pageFor(panel.webview, media);
  const handle = createController({
    engine,
    post: (message) => panel.webview.postMessage(message),
    // Only when the person is not looking at Mayfly: there, the conversation already says it.
    notify: ({ text, failed }) => {
      if (!panel.active) api.window.showNotification({ title: "Mayfly", body: text, type: failed ? "error" : "info" });
    },
    openExternal: (url) => api.env.openExternal(api.Uri.parse(url)),
    copy: (text) => api.env.clipboard.writeText(text),
    doctor: () =>
      examine({
        podman: versions,
        runtimeReady: () => imageExists(RUNTIME_IMAGE),
        signIn: async () => (await engine.health()).find((service) => service.kind === "sign-in")?.containers.map((container) => container.state) ?? [],
        models: () => Promise.all(models.models().models.map((setting) => probe(setting, keys))),
      }),
    settings: {
      ...models,
      // Peek behind the curtain was developer mode's first name; whoever turned it on keeps it on.
      developer: () => settings().get<boolean>("developerMode") ?? settings().get<boolean>("peek") ?? false,
      saveDeveloper: (on) => settings().update("developerMode", on),
      autostart: () => settings().get<boolean>("autostart") ?? false,
      saveAutostart: (on) => settings().update("autostart", on),
    },
    keys,
  });
  context.subscriptions.push(panel.webview.onDidReceiveMessage(handle));
  return { panel, handle };
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
    provider: providerOf(setting),
    // Without a key when none is saved, as local providers often need none. One that does says so, and the person hears where to add it.
    async complete(system, messages, listener) {
      const baseUrl = endpointOf(setting);
      const apiKey = await keys.get(baseUrl);
      try {
        return await openAiCompatibleModel({ baseUrl, ...(apiKey ? { apiKey } : {}), model: setting.model }).complete(system, messages, listener);
      } catch (error) {
        if (error instanceof KeyNeeded) throw new Error(`${name} needs an API key. Add it in Settings → Models.`);
        throw error;
      }
    },
  };
}

type ModelStore = ModelPorts["settings"];

function settings(): api.Configuration {
  return api.configuration.getConfiguration("mayfly");
}

/** A model the doctor can try: its key is checked by listing the provider's models, which costs nothing. */
async function probe(setting: ModelSetting, keys: KeyStore): Promise<ModelProbe> {
  const baseUrl = endpointOf(setting);
  const apiKey = await keys.get(baseUrl);
  return { id: setting.id, model: setting.model, hasKey: Boolean(apiKey), list: () => listModels({ baseUrl, ...(apiKey ? { apiKey } : {}) }) };
}

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
