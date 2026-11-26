import type { AppView, ServiceHealth } from "../../../engine/engine.ts";
import type { Usage } from "../../../engine/usage.ts";
import type { ToUi } from "../messages.ts";
import { h } from "./dom.ts";
import { compact } from "./format.ts";
import { icon } from "./icons.ts";
import { lightFor, type Colour } from "./lights.ts";
import { popover } from "./popover.ts";

type State = Extract<ToUi, { type: "state" }>;

const COUNTED: readonly [Colour, string][] = [
  ["starting", "starting"],
  ["green", "running"],
  ["yellow", "restarted"],
  ["unhealthy", "unhealthy"],
  ["red", "stopped"],
  ["orange", "in the works"],
  ["grey", "never ran"],
];

/** Wires the status bar: the apps lead to how they are running, the tokens open a breakdown by app. */
export function setUpStatusbar(openSettings: (tab: "logs") => void): void {
  element("status-apps").addEventListener("click", () => openSettings("logs"));
  popover(element("status-tokens"), element("token-popover"));
}

export function renderStatusbar(state: State, app: AppView | undefined, health: readonly ServiceHealth[] | undefined): void {
  const apps = appCounts(state, health);
  element("status-apps").replaceChildren(...apps.shown);
  element("status-apps").title = apps.said === "" ? "No apps yet" : apps.said;
  element("status-apps").setAttribute("aria-label", apps.said === "" ? "No apps yet" : apps.said);
  element("token-info").replaceChildren(...tokenSummary(app, state.spent));
  element("token-popover").replaceChildren(tokenBreakdown(state));
}

/** How many apps show each light, for the colours that have any: each light and its number, with the words for hovering and for screen readers. */
function appCounts(state: State, health: readonly ServiceHealth[] | undefined): { readonly shown: Node[]; readonly said: string } {
  const colours = state.apps.map((app) => lightFor(app, health, state.working?.app).colour);
  const counted = COUNTED.flatMap(([colour, word]) => {
    const many = colours.filter((c) => c === colour).length;
    return many === 0 ? [] : [{ colour, said: `${many} ${word}`, many }];
  });
  if (counted.length === 0) return { shown: [document.createTextNode("No apps yet")], said: "" };
  const said = counted.map((count) => count.said).join(", ");
  const shown = counted.map(({ colour, said: words, many }) => {
    const count = h("span", "status-count", h("span", `light ${colour}`), String(many));
    count.title = words;
    return count;
  });
  return { shown, said };
}

// The app on screen, or every app when none is. The popover has every app's, and the total.
function tokenSummary(app: AppView | undefined, spent: Usage): (Node | string)[] {
  return app === undefined ? [h("span", "quiet", "All apps"), ...counts(spent)] : [h("span", "", app.name), ...counts(app.spent)];
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
    h("table", "token-table", h("tbody", "", ...rows, tokenRow("Total (includes removed apps)", spent, "total", thinking))),
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

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
