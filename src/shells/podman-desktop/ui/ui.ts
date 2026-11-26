import type { DeployedApp } from "../../../engine/engine.ts";
import type { FromUi, ToUi } from "../messages.ts";

// Podman Desktop puts this function on every webview page, to send messages to the extension.
declare function acquirePodmanDesktopApi(): { postMessage(message: FromUi): void };

const podmanDesktop = acquirePodmanDesktopApi();
let busy = false;

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

window.addEventListener("message", (event: MessageEvent<ToUi>) => show(event.data));

element<HTMLFormElement>("create-form").addEventListener("submit", (event) => {
  event.preventDefault();
  podmanDesktop.postMessage({ type: "create", description: element<HTMLTextAreaElement>("description").value });
});

element<HTMLFormElement>("key-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = element<HTMLInputElement>("key-input");
  podmanDesktop.postMessage({ type: "save-api-key", apiKey: input.value });
  input.value = "";
});

element<HTMLButtonElement>("copy-password").addEventListener("click", () => podmanDesktop.postMessage({ type: "copy-password" }));

podmanDesktop.postMessage({ type: "ready" });

function show(message: ToUi): void {
  switch (message.type) {
    case "state":
      return showState(message);
    case "busy":
      return setStatus(message.text, { busy: true });
    case "notice":
      return setStatus(message.text, {});
    case "error":
      return setStatus(message.text, { error: true });
  }
}

function showState(state: Extract<ToUi, { type: "state" }>): void {
  if (busy) setStatus("", {});
  element("key").hidden = state.hasApiKey;
  element<HTMLButtonElement>("create").disabled = !state.hasApiKey || busy;
  element("apps").replaceChildren(...state.apps.map(appItem));
  element("no-apps").hidden = state.apps.length > 0;
  element("owner").textContent = state.owner;
  element("sign-in").hidden = false;
  element("model").textContent = `Apps are written by ${state.model}.`;
}

// Built from text nodes only, so nothing in a name or URL can become markup.
function appItem(app: DeployedApp): HTMLLIElement {
  const item = document.createElement("li");
  const name = document.createElement("span");
  name.textContent = app.name;
  item.append(name, button("Open", { type: "open", name: app.name }), button("Remove", { type: "remove", name: app.name }));
  return item;
}

function button(label: string, message: FromUi): HTMLButtonElement {
  const control = document.createElement("button");
  control.type = "button";
  control.textContent = label;
  control.addEventListener("click", () => podmanDesktop.postMessage(message));
  return control;
}

function setStatus(text: string, { busy: nowBusy = false, error = false }: { busy?: boolean; error?: boolean }): void {
  busy = nowBusy;
  const status = element("status");
  status.textContent = text;
  status.classList.toggle("error", error);
  element<HTMLButtonElement>("create").disabled = nowBusy;
}
