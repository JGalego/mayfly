import type { ModelCheck } from "../doctor.ts";
import type { FromUi, ModelView, ToUi } from "../messages.ts";
import { isProvider, PROVIDERS } from "../settings.ts";
import { findingMark } from "./doctor-view.ts";
import { h, keepTime } from "./dom.ts";

type State = Extract<ToUi, { type: "state" }>;

const provider = element<HTMLSelectElement>("provider");
const endpoint = element<HTMLInputElement>("endpoint");
const modelName = element<HTMLInputElement>("model-name");
const called = element<HTMLInputElement>("model-called");
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
    post({ type: "save-model", model: { id: editing, provider: provider.value, baseUrl: endpoint.value, model: modelName.value, name: called.value }, apiKey: apiKey.value });
    apiKey.value = "";
  });
}

/** Opens the form on a model, or on a new one. */
export function openForm(model: ModelView | undefined): void {
  editing = model?.id ?? "";
  provider.value = model?.provider ?? "openai";
  endpoint.value = model?.baseUrl ?? "";
  modelName.value = model?.model ?? "";
  called.value = model?.name ?? "";
  apiKey.value = "";
  apiKey.placeholder = model?.hasApiKey === true ? "Leave blank to keep the saved key" : "";
  element("model-form-title").textContent = model === undefined ? "Add a model" : `Change ${model.label}`;
  showEndpointField();
}

/** The extension answered a save: with the new state when it kept the model, with an error when it did not. Says whether a save was kept. */
export function savedModel(kept: boolean): boolean {
  if (!saving) return false;
  saving = false;
  if (kept) editing = undefined;
  return kept;
}

/** Each model as a card, with how its key fared when the doctor tried it, or undefined while it tries. */
export function renderModels(state: State, checks: readonly ModelCheck[] | undefined, post: (message: FromUi) => void, redraw: () => void): void {
  const card = (model: ModelView): HTMLLIElement => modelCard(model, model.id === state.defaultModel, keyCheck(model, checks), post, redraw);
  element("model-list").replaceChildren(...state.models.map(card));
  element("model-form").hidden = editing === undefined;
  element("add-model").hidden = editing !== undefined;
}

function modelCard(model: ModelView, isDefault: boolean, check: HTMLElement[], post: (message: FromUi) => void, redraw: () => void): HTMLLIElement {
  const where = model.provider === "openai" ? "api.openai.com" : hostOf(model.baseUrl);
  const name = h("p", "model-label", h("span", "model-title", model.name ?? model.model), ...(isDefault ? [h("span", "badge", "Default")] : []));
  name.title = model.label;
  // A name hides which model it is, so the facts say.
  const facts = h("p", "quiet model-where", [...(model.name === undefined ? [] : [model.model]), where].join(" · "));
  facts.title = model.provider === "openai" ? where : model.baseUrl;
  const actions = [
    ...(isDefault ? [] : [button("Make default", () => post({ type: "default-model", id: model.id }))]),
    button("Change", () => {
      openForm(model);
      redraw();
    }),
    ...(isDefault ? [] : [button("Remove", () => post({ type: "remove-model", id: model.id }), true)]),
  ];
  return h("li", "model-card", monogram(where), h("div", "model-facts", name, facts, ...check), h("div", "model-actions", ...actions));
}

/** The provider's first letter on a tint of its own, so each provider looks the same wherever it shows. */
function monogram(host: string): HTMLElement {
  const word = host.replace(/^(api|www)\./, "").split(/[.:]/)[0] ?? host;
  const badge = h("span", "monogram", (word[0] ?? "?").toUpperCase());
  badge.setAttribute("aria-hidden", "true");
  badge.style.setProperty("--hue", String([...word].reduce((sum, letter) => (sum * 31 + letter.charCodeAt(0)) % 360, 7)));
  return badge;
}

function hostOf(url: string): string {
  return URL.canParse(url) ? new URL(url).host : url;
}

function keyCheck(model: ModelView, checks: readonly ModelCheck[] | undefined): HTMLElement[] {
  const check = checks?.find(({ id }) => id === model.id);
  if (check === undefined) return [h("p", "model-check quiet", keepTime(h("span", "finding-mark spinner")), "Checking…")];
  return [h("p", `model-check ${check.status}`, findingMark(check.status), check.detail)];
}

function button(label: string, act: () => void, destructive = false): HTMLButtonElement {
  const control = h("button", destructive ? "secondary destructive" : "secondary", label);
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
