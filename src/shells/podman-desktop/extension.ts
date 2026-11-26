import * as api from "@podman-desktop/api";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dexIdentity } from "../../adapters/dex/dex-identity.ts";
import { jsonFileStore } from "../../adapters/json-file/json-file-store.ts";
import { openAiCompatibleModel } from "../../adapters/openai-compatible/openai-compatible-model.ts";
import { podmanBuilder } from "../../adapters/podman/podman-builder.ts";
import { podmanDeployer } from "../../adapters/podman/podman.ts";
import { createEngine, type Engine } from "../../engine/engine.ts";
import type { ModelProvider } from "../../engine/ports.ts";
import { createController, type ControllerPorts } from "./controller.ts";
import { endpointOf, isProvider, type ModelChoice } from "./settings.ts";

// The published, signed runtime this version builds apps on. The README shows how to verify it.
const RUNTIME_IMAGE = "ghcr.io/jgalego/mayfly-runtime@sha256:1d30bd9e46727f4f116861a24851c84c267bd79803f75b040c9d223846bebd05";

type Panel = ReturnType<typeof api.window.createWebviewPanel>;

export async function activate(context: api.ExtensionContext): Promise<void> {
  const keys = keyStore(context.secrets);
  const engine = createEngine({
    store: jsonFileStore(join(context.storagePath, "state.json")),
    deployer: podmanDeployer,
    identity: dexIdentity,
    model: configuredModel(keys),
    builder: podmanBuilder(RUNTIME_IMAGE),
  });
  let panel: Panel | undefined;
  const show = async (): Promise<void> => {
    if (panel !== undefined) return panel.reveal();
    panel = await openPanel(context, engine, keys);
    panel.onDidDispose(() => (panel = undefined));
  };
  context.subscriptions.push(api.commands.registerCommand("mayfly.open", show));
  await show();
}

async function openPanel(context: api.ExtensionContext, engine: Engine, keys: KeyStore): Promise<Panel> {
  const media = api.Uri.joinPath(context.extensionUri, "media");
  const panel = api.window.createWebviewPanel("mayfly", "Mayfly", { localResourceRoots: [media] });
  panel.iconPath = api.Uri.joinPath(context.extensionUri, "icon.png");
  context.subscriptions.push(panel);
  panel.webview.html = await pageFor(panel.webview, media);
  const handle = createController({
    engine,
    post: (message) => panel.webview.postMessage(message),
    openExternal: (url) => api.env.openExternal(api.Uri.parse(url)),
    copy: (text) => api.env.clipboard.writeText(text),
    settings: { read: readChoice, save: saveChoice },
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

// The settings and key are read on each call, so a change works without restarting anything.
function configuredModel(keys: KeyStore): ModelProvider {
  return {
    async complete(system, messages) {
      const choice = readChoice();
      const baseUrl = endpointOf(choice);
      const apiKey = await keys.get(baseUrl);
      if (!apiKey) throw new Error("Add your API key in Settings first.");
      return openAiCompatibleModel({ baseUrl, apiKey, model: choice.model }).complete(system, messages);
    },
  };
}

function readChoice(): ModelChoice {
  const settings = api.configuration.getConfiguration("mayfly");
  const provider = settings.get<string>("model.provider");
  return {
    provider: isProvider(provider) ? provider : "openai",
    baseUrl: settings.get<string>("model.baseUrl") ?? "",
    model: settings.get<string>("model.name") ?? "",
  };
}

async function saveChoice({ provider, baseUrl, model }: ModelChoice): Promise<void> {
  const settings = api.configuration.getConfiguration("mayfly");
  await settings.update("model.provider", provider);
  await settings.update("model.baseUrl", baseUrl);
  await settings.update("model.name", model);
}
