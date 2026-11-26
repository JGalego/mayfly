import * as api from "@podman-desktop/api";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dexIdentity } from "../../adapters/dex/dex-identity.ts";
import { jsonFileStore } from "../../adapters/json-file/json-file-store.ts";
import { openAiCompatibleModel, type ModelSettings } from "../../adapters/openai-compatible/openai-compatible-model.ts";
import { podmanBuilder } from "../../adapters/podman/podman-builder.ts";
import { podmanDeployer } from "../../adapters/podman/podman.ts";
import { createEngine, type Engine } from "../../engine/engine.ts";
import type { ModelProvider } from "../../engine/ports.ts";
import { createController } from "./controller.ts";

// The published, signed runtime this version builds apps on. The README shows how to verify it.
const RUNTIME_IMAGE = "ghcr.io/jgalego/mayfly-runtime@sha256:1d30bd9e46727f4f116861a24851c84c267bd79803f75b040c9d223846bebd05";
const API_KEY_SECRET = "mayfly.model.apiKey";

type Panel = ReturnType<typeof api.window.createWebviewPanel>;

export async function activate(context: api.ExtensionContext): Promise<void> {
  const engine = createEngine({
    store: jsonFileStore(join(context.storagePath, "state.json")),
    deployer: podmanDeployer,
    identity: dexIdentity,
    model: modelWithStoredKey(context.secrets),
    builder: podmanBuilder(RUNTIME_IMAGE),
  });
  let panel: Panel | undefined;
  const show = async (): Promise<void> => {
    if (panel !== undefined) return panel.reveal();
    panel = await openPanel(context, engine);
    panel.onDidDispose(() => (panel = undefined));
  };
  context.subscriptions.push(api.commands.registerCommand("mayfly.open", show));
  await show();
}

async function openPanel(context: api.ExtensionContext, engine: Engine): Promise<Panel> {
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
    apiKey: {
      isSet: async () => Boolean(await context.secrets.get(API_KEY_SECRET)),
      save: (key) => context.secrets.store(API_KEY_SECRET, key),
    },
    modelName: () => modelSettings().model,
  });
  context.subscriptions.push(panel.webview.onDidReceiveMessage(handle));
  return panel;
}

/** The page from media/, with its files turned into webview URIs and its CSP allowing only them. */
async function pageFor(webview: api.Webview, media: api.Uri): Promise<string> {
  const page = await readFile(api.Uri.joinPath(media, "index.html").fsPath, "utf8");
  const uri = (file: string): string => webview.asWebviewUri(api.Uri.joinPath(media, file)).toString();
  return page
    .replaceAll("{{cspSource}}", webview.cspSource)
    .replace('href="ui.css"', `href="${uri("ui.css")}"`)
    .replace('src="ui.js"', `src="${uri("ui.js")}"`);
}

// The key is read each time, so a newly saved one works without restarting anything.
function modelWithStoredKey(secrets: api.SecretStorage): ModelProvider {
  return {
    async complete(system, messages) {
      const apiKey = await secrets.get(API_KEY_SECRET);
      if (!apiKey) throw new Error("Add your OpenAI API key first.");
      return openAiCompatibleModel({ ...modelSettings(), apiKey }).complete(system, messages);
    },
  };
}

function modelSettings(): Omit<ModelSettings, "apiKey"> {
  const settings = api.configuration.getConfiguration("mayfly");
  return { baseUrl: settings.get<string>("model.baseUrl") ?? "", model: settings.get<string>("model.name") ?? "" };
}
