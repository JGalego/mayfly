import type { AppView, ServiceHealth } from "../../../engine/engine.ts";
import type { Usage } from "../../../engine/usage.ts";
import type { ModelView, ToUi } from "../messages.ts";
import { h } from "./dom.ts";
import { lightFor, type Colour } from "./lights.ts";

type State = Extract<ToUi, { type: "state" }>;

const COUNTED: readonly [Colour, string][] = [
  ["green", "running"],
  ["yellow", "restarted"],
  ["red", "stopped"],
  ["orange", "in the works"],
  ["grey", "never ran"],
];

/** Wires the status bar: the model and the apps lead to Settings, the tokens open a breakdown by app. */
export function setUpStatusbar(openSettings: () => void): void {
  element("status-model").addEventListener("click", openSettings);
  element("status-apps").addEventListener("click", openSettings);
  const popover = element("token-popover");
  element("status-tokens").addEventListener("click", () => setOpen(popover.hidden === true));
  document.addEventListener("keydown", (event) => event.key === "Escape" && setOpen(false));
  document.addEventListener("click", (event) => {
    const target = event.target as Node;
    if (!popover.contains(target) && !element("status-tokens").contains(target)) setOpen(false);
  });
}

export function renderStatusbar(state: State, app: AppView | undefined, model: ModelView | undefined, health: readonly ServiceHealth[] | undefined): void {
  element("model-info").textContent = model === undefined ? "No model" : model.label;
  element("model-warning").hidden = model?.hasApiKey !== false;
  element("status-apps").replaceChildren(...appCounts(state, health));
  element("token-info").replaceChildren(...tokenSummary(app, state.spent));
  element("token-popover").replaceChildren(tokenBreakdown(state));
}

/** How many apps show each light, the colours that have any. */
function appCounts(state: State, health: readonly ServiceHealth[] | undefined): Node[] {
  const colours = state.apps.map((app) => lightFor(app, health, state.working?.app).colour);
  const shown = COUNTED.filter(([colour]) => colours.includes(colour));
  if (shown.length === 0) return [document.createTextNode("No apps yet")];
  return shown.map(([colour, word]) => h("span", "status-count", h("span", `light ${colour}`), `${colours.filter((c) => c === colour).length} ${word}`));
}

function tokenSummary(app: AppView | undefined, spent: Usage): (Node | string)[] {
  const all = [h("span", "quiet", "All apps"), ...inOut(spent)];
  return app === undefined ? ["🪙 ", ...all] : ["🪙 ", h("span", "", app.name), ...inOut(app.spent), h("span", "status-divider", "·"), ...all];
}

function inOut({ input, output }: Usage): Node[] {
  return [h("span", "token-in", ` ↑ ${input.toLocaleString()}`), h("span", "token-out", ` ↓ ${output.toLocaleString()}`)];
}

/** Every app's tokens, the hungriest first, and the total, removed apps included. */
function tokenBreakdown({ apps, spent }: State): HTMLElement {
  const rows = [...apps].sort((a, b) => total(b.spent) - total(a.spent)).map((app) => tokenRow(app.name, app.spent, ""));
  return h(
    "div",
    "",
    h("p", "popover-title", "Tokens by app"),
    h("p", "quiet", "↑ sent to the model, ↓ written by it"),
    h("table", "token-table", h("tbody", "", ...rows, tokenRow("All, removed apps too", spent, "total"))),
  );
}

function tokenRow(name: string, usage: Usage, className: string): HTMLTableRowElement {
  return h("tr", className, h("td", "", name), h("td", "token-in", `↑ ${usage.input.toLocaleString()}`), h("td", "token-out", `↓ ${usage.output.toLocaleString()}`));
}

function total({ input, output }: Usage): number {
  return input + output;
}

function setOpen(open: boolean): void {
  element("token-popover").hidden = !open;
  element("status-tokens").setAttribute("aria-expanded", String(open));
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
