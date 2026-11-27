import * as api from "@podman-desktop/api";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dexIdentity } from "../../adapters/dex/dex-identity.ts";
import { readJson, writeJson } from "../../adapters/json-file/json-file.ts";
import { jsonFileStore } from "../../adapters/json-file/json-file-store.ts";
import { fileStore } from "../../adapters/files/file-store.ts";
import { KeyNeeded, listModels, openAiCompatibleModel } from "../../adapters/openai-compatible/openai-compatible-model.ts";
import { podmanBuilder } from "../../adapters/podman/podman-builder.ts";
import { send, verify } from "../../adapters/smtp/smtp.ts";
import { imageExists, podmanDeployer, podmanObserver, versions } from "../../adapters/podman/podman.ts";
import { tailscaleNetwork } from "../../adapters/tailscale/tailscale.ts";
import { createEngine, type Engine } from "../../engine/engine.ts";
import type { ModelProvider, PhoneNetwork } from "../../engine/ports.ts";
import { createController, type ControllerPorts } from "./controller.ts";
import { examine, type ModelProbe } from "./doctor.ts";
import type { MailAccount } from "./mail-account.ts";
import { LOGO } from "./mail-html.ts";
import type { ModelPorts } from "./model-settings.ts";
import { endpointOf, FIRST_MODELS, isProvider, labelOf, modelFor, providerOf, type Models, type ModelSetting } from "./settings.ts";

// The published, signed runtime this version builds apps on: a list of its amd64 and arm64 images, from which Podman
// pulls the machine's own. The README shows how to verify it.
const RUNTIME_IMAGE = "ghcr.io/jgalego/mayfly-runtime@sha256:b2110a88d5956cde9608da1f05636e02f0573daae30ea609d8419e221f01cffd";

type Panel = ReturnType<typeof api.window.createWebviewPanel>;

export async function activate(context: api.ExtensionContext): Promise<void> {
  const keys = keyStore(context.secrets);
  const models = await modelStore(join(context.storagePath, "models.json"));
  const logo = await readFile(api.Uri.joinPath(context.extensionUri, "media", "logo.svg").fsPath, "utf8");
  const phoneNetwork = tailscaleNetwork();
  const engine = createEngine({
    store: jsonFileStore(join(context.storagePath, "state.json")),
    deployer: podmanDeployer,
    observer: podmanObserver,
    identity: dexIdentity(logo),
    models: (id) => configuredModel(modelFor(models.models(), id), keys),
    builder: podmanBuilder(RUNTIME_IMAGE),
    files: fileStore(join(context.storagePath, "files")),
    phoneNetwork,
  });
  let panel: Panel | undefined;
  let handle: Handler = async () => {};
  const show = async (): Promise<void> => {
    if (panel !== undefined) return panel.reveal();
    ({ panel, handle } = await openPanel(context, engine, keys, models, phoneNetwork));
    panel.onDidDispose(() => (panel = undefined));
  };
  context.subscriptions.push(api.commands.registerCommand("mayfly.open", show));
  await show();
  whenPodmanAnswers(context, () => void startApps(context, (message) => handle(message)));
}

/** Runs the running apps again if Mayfly updated since they last ran, then starts the stopped ones if the person wants. */
async function startApps(context: api.ExtensionContext, handle: Handler): Promise<void> {
  await runAgainIfUpdated(context, handle);
  if (settings().get<boolean>("autostart") === true) await handle({ type: "start-stopped" });
}

// Running apps keep the objects they started with, so a fix to how Mayfly runs apps reaches them only once they run again.
async function runAgainIfUpdated(context: api.ExtensionContext, handle: Handler): Promise<void> {
  const ranWith = join(context.storagePath, "apps-ran-with.json");
  const { version } = (await readJson(api.Uri.joinPath(context.extensionUri, "package.json").fsPath)) as { version: string };
  if (((await readJson(ranWith)) as { version?: string } | undefined)?.version === version) return;
  await handle({ type: "updated" });
  await writeJson(ranWith, { version });
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

async function openPanel(context: api.ExtensionContext, engine: Engine, keys: KeyStore, models: ModelStore, phoneNetwork: PhoneNetwork): Promise<{ panel: Panel; handle: Handler }> {
  const media = api.Uri.joinPath(context.extensionUri, "media");
  const panel = api.window.createWebviewPanel("mayfly", "Mayfly", { localResourceRoots: [media] });
  // The navigation bar shows this file by its path: the same logo as the page, sharp at any size.
  panel.iconPath = api.Uri.joinPath(media, "logo.svg");
  context.subscriptions.push(panel);
  panel.webview.html = await pageFor(panel.webview, media);
  const logo = await readFile(api.Uri.joinPath(context.extensionUri, "icon.png").fsPath);
  const handle = createController({
    engine,
    post: (message) => panel.webview.postMessage(message),
    // Only when the person is not looking at Mayfly, on another page or in another window: there, the conversation already says it.
    notify: ({ text, failed, seen }) => {
      if (!panel.active || !seen) api.window.showNotification({ title: "Mayfly", body: text, type: failed ? "error" : "info" });
    },
    openExternal: (url) => api.env.openExternal(api.Uri.parse(url)),
    copy: (text) => api.env.clipboard.writeText(text),
    doctor: () =>
      examine({
        podman: versions,
        runtimeReady: () => imageExists(RUNTIME_IMAGE),
        signIn: async () => (await engine.health()).find((service) => service.kind === "sign-in")?.containers.map((container) => container.state) ?? [],
        models: () => Promise.all(models.models().models.map((setting) => probe(setting, keys))),
        phoneHost: () => engine.phoneAccess(),
        phoneNetwork: () => phoneNetwork.status(),
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
    mail: mailAccount(context.secrets, logo),
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
        if (error instanceof KeyNeeded) throw new Error(`\`${name}\` needs an API key. Add it in Settings → Models.`);
        throw error;
      }
    },
  };
}

const MAIL_ACCOUNT = "mayfly.mail";

// The account is kept whole in secret storage, so its password stays with the server it was given for.
function mailAccount(secrets: api.SecretStorage, logo: Uint8Array): ControllerPorts["mail"] {
  return {
    account: async () => {
      const saved = await secrets.get(MAIL_ACCOUNT);
      return saved === undefined ? undefined : (JSON.parse(saved) as MailAccount);
    },
    save: (account) => secrets.store(MAIL_ACCOUNT, JSON.stringify(account)),
    remove: () => secrets.delete(MAIL_ACCOUNT),
    verify,
    send: (account, message) => send(account, { ...message, images: [{ ...LOGO, content: logo }] }),
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
