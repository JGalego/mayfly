import type { FromUi, ModelView, ToUi } from "../messages.ts";
import { isProvider, PROVIDERS } from "../settings.ts";
import { h } from "./dom.ts";

type State = Extract<ToUi, { type: "state" }>;

const provider = element<HTMLSelectElement>("provider");
const endpoint = element<HTMLInputElement>("endpoint");
const modelName = element<HTMLInputElement>("model-name");
const apiKey = element<HTMLInputElement>("api-key");

/** The model the form edits: an id, "" for a new one, or undefined while the form is closed. */
let editing: string | undefined;
/** A save the extension has not answered yet. The form closes when it accepts, and stays open when it refuses. */
let saving = false;

/** Wires the Models section of Settings to the extension. */
export function setUpModels(post: (message: FromUi) => void, redraw: () => void): void {
  provider.replaceChildren(...Object.entries(PROVIDERS).map(([value, label]) => new Option(label, value)));
  provider.addEventListener("change", showEndpointField);
  element("add-model").addEventListener("click", () => {
    openForm(undefined);
    redraw();
  });
  element("cancel-model").addEventListener("click", () => {
    editing = undefined;
    redraw();
  });
  element("model-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (editing === undefined || !isProvider(provider.value)) return;
    saving = true;
    post({ type: "save-model", model: { id: editing, provider: provider.value, baseUrl: endpoint.value, model: modelName.value }, apiKey: apiKey.value });
    apiKey.value = "";
  });
}

/** Opens the form on a model, or on a new one. */
export function openForm(model: ModelView | undefined): void {
  editing = model?.id ?? "";
  provider.value = model?.provider ?? "openai";
  endpoint.value = model?.baseUrl ?? "";
  modelName.value = model?.model ?? "";
  apiKey.value = "";
  apiKey.placeholder = model?.hasApiKey === true ? "Saved. Paste a new key to replace it." : "Paste your API key";
  element("model-form-title").textContent = model === undefined ? "Add a model" : `Change ${model.label}`;
  showEndpointField();
}

/** The extension answered a save: with the new state when it kept the model, with an error when it did not. */
export function savedModel(kept: boolean): void {
  if (!saving) return;
  saving = false;
  if (kept) editing = undefined;
}

export function renderModels(state: State, post: (message: FromUi) => void, redraw: () => void): void {
  element("model-list").replaceChildren(...state.models.map((model) => modelCard(model, model.id === state.defaultModel, post, redraw)));
  element("model-form").hidden = editing === undefined;
  element("add-model").hidden = editing !== undefined;
}

function modelCard(model: ModelView, isDefault: boolean, post: (message: FromUi) => void, redraw: () => void): HTMLLIElement {
  const where = model.provider === "openai" ? "api.openai.com" : model.baseUrl;
  const name = h("p", "model-label", model.label, ...(isDefault ? [" ", h("span", "badge", "Default")] : []));
  const facts = h("p", "quiet", `${where} · ${model.hasApiKey ? "key saved" : "no API key yet"}`);
  const actions = [
    ...(isDefault ? [] : [button("Make default", () => post({ type: "default-model", id: model.id }))]),
    button("Change", () => {
      openForm(model);
      redraw();
    }),
    ...(isDefault ? [] : [button("Remove", () => post({ type: "remove-model", id: model.id }))]),
  ];
  return h("li", "model-card", h("div", "model-facts", name, facts), h("div", "model-actions", ...actions));
}

function button(label: string, act: () => void): HTMLButtonElement {
  const control = h("button", "quiet-button", label);
  control.type = "button";
  control.addEventListener("click", act);
  return control;
}

function showEndpointField(): void {
  const compatible = provider.value === "openai-compatible";
  for (const field of document.querySelectorAll<HTMLElement>(".compatible-only")) field.hidden = !compatible;
  endpoint.required = compatible;
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
