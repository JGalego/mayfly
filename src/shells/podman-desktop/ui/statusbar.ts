import type { AppView, ServiceHealth } from "../../../engine/engine.ts";
import type { Usage } from "../../../engine/usage.ts";
import type { ModelView, ToUi } from "../messages.ts";
import { h } from "./dom.ts";
import { compact } from "./format.ts";
import { icon } from "./icons.ts";
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
  const all = [h("span", "quiet", "All apps"), ...counts(spent)];
  return app === undefined ? all : [h("span", "", app.name), ...counts(app.spent), h("span", "status-divider", "·"), ...all];
}

// Thinking shows only once a provider has counted some: most never do.
function counts({ input, output, thinking }: Usage): Node[] {
  const spent = [count("token-in", ["↑ "], input), count("token-out", ["↓ "], output)];
  return thinking === 0 ? spent : [...spent, count("token-thinking", [icon("thinking"), " "], thinking)];
}

// Short to glance at, exact on hover.
function count(className: string, marker: readonly (Node | string)[], value: number): HTMLElement {
  const shown = h("span", className, " ", ...marker, compact(value));
  shown.title = value.toLocaleString();
  return shown;
}

/** Every app's tokens, the hungriest first, and the total, removed apps included. */
function tokenBreakdown({ apps, spent }: State): HTMLElement {
  const thinking = spent.thinking > 0;
  const rows = [...apps].sort((a, b) => total(b.spent) - total(a.spent)).map((app) => tokenRow(app.name, app.spent, "", thinking));
  return h(
    "div",
    "",
    h("p", "popover-title", "Tokens by app"),
    h("p", "quiet", ...(thinking ? ["↑ sent to the model, ↓ written in its replies, ", icon("thinking"), " spent thinking"] : ["↑ sent to the model, ↓ written by it"])),
    h("table", "token-table", h("tbody", "", ...rows, tokenRow("All, removed apps too", spent, "total", thinking))),
  );
}

function tokenRow(name: string, usage: Usage, className: string, thinking: boolean): HTMLTableRowElement {
  const cells = [h("td", "", name), h("td", "token-in", `↑ ${compact(usage.input)}`), h("td", "token-out", `↓ ${compact(usage.output)}`)];
  if (thinking) cells.push(h("td", "token-thinking", icon("thinking"), ` ${compact(usage.thinking)}`));
  return h("tr", className, ...cells);
}

function total({ input, output, thinking }: Usage): number {
  return input + output + thinking;
}

function setOpen(open: boolean): void {
  element("token-popover").hidden = !open;
  element("status-tokens").setAttribute("aria-expanded", String(open));
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
