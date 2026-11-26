import type { ModelCall } from "../../../engine/state.ts";
import { addUsage, NO_USAGE, type Usage } from "../../../engine/usage.ts";
import { h } from "./dom.ts";
import { compact } from "./format.ts";
import { groupsOf, periodsOf, spanStart, ticksFor, totalOf, UNNAMED, unrecorded, type Grain, type GroupBy, type Period, type Span } from "./ledger.ts";

const SPANS: readonly [string, string, Span][] = [
  ["days", "Last 14 days", { grain: "day", periods: 14 }],
  ["weeks", "Last 12 weeks", { grain: "week", periods: 12 }],
  ["months", "Last 12 months", { grain: "month", periods: 12 }],
  ["all", "All time", { grain: "month", periods: "all" }],
];

const GROUPINGS: readonly [GroupBy, string][] = [
  ["model", "By model"],
  ["provider", "By provider"],
  ["app", "By app"],
];

// Bottom to top in each column, and in the legend's order.
const SERIES: readonly [keyof Usage, string][] = [
  ["input", "Tokens in"],
  ["output", "Tokens out"],
  ["thinking", "Thinking"],
];

/** What the page knows that the ledger does not: everything spent, and the apps that still exist. */
export interface Context {
  readonly spent: Usage;
  readonly apps: readonly string[];
}

export interface LedgerView {
  readonly element: HTMLElement;
  /** Shows the calls, or that they are being fetched, redrawing only when something changed. */
  show(calls: readonly ModelCall[] | undefined, context: Context): void;
}

/** What the models spent and when: a span and a grouping to pick, a column per period, and the same as tables. */
export function ledgerView(): LedgerView {
  const span = picker(SPANS.map(([value, label]) => [value, label]), "days", "How far back");
  const grouping = picker(GROUPINGS, "model", "Group by");
  const body = h("div", "ledger-body");
  let shown: { calls: readonly ModelCall[] | undefined; context: Context; key: string } | undefined;
  const render = (): void => {
    if (shown === undefined) return;
    const chosen = SPANS.find(([value]) => value === span.value)?.[2] ?? { grain: "day", periods: 14 };
    body.replaceChildren(...(shown.calls === undefined ? [h("p", "quiet", "Fetching…")] : ledgerBody(shown.calls, shown.context, chosen, grouping.value as GroupBy)));
  };
  for (const control of [span, grouping]) control.addEventListener("change", render);
  return {
    element: h("div", "ledger", h("div", "log-controls", span, grouping), body),
    show(calls, context) {
      const key = JSON.stringify([calls?.length, context]);
      if (shown !== undefined && shown.calls === calls && shown.key === key) return;
      shown = { calls, context, key };
      render();
    },
  };
}

function ledgerBody(calls: readonly ModelCall[], context: Context, span: Span, by: GroupBy): Node[] {
  const now = new Date();
  const from = spanStart(span, calls, now);
  const periods = periodsOf(calls, span.grain, from, now);
  const since = span.periods === "all" ? 0 : from.getTime();
  const inSpan = calls.filter((call) => call.at >= since);
  const spent = sum(inSpan.map((call) => call.spent));
  if (inSpan.length === 0) return [h("p", "quiet", "No calls to a model in this time.")];
  const missing = span.periods === "all" ? unrecorded(context.spent, calls) : undefined;
  return [legend(spent, inSpan.length), chart(periods, span.grain), groupTable(inSpan, by, context.apps, since, missing), periodTable(periods, span.grain)];
}

/** Which colour is which, with each one's total, so the legend doubles as the summary. */
function legend(spent: Usage, calls: number): HTMLElement {
  const items = SERIES.map(([key, label]) => h("span", "legend-item", h("span", `swatch series-${key}`), `${label} `, h("strong", "", compact(spent[key]))));
  return h("p", "usage-legend", ...items, h("span", "quiet", `${calls.toLocaleString()} ${calls === 1 ? "call" : "calls"}`));
}

/** A column per period, its tokens stacked in, out and thinking, with round ticks behind and a readout on hover or focus. */
function chart(periods: readonly Period[], grain: Grain): HTMLElement {
  const ticks = ticksFor(Math.max(...periods.map((period) => totalOf(period.spent))));
  const top = ticks.at(-1) ?? 1;
  const readout = h("div", "usage-readout");
  readout.hidden = true;
  const grid = ticks.map((tick) => {
    const line = h("div", "usage-grid", h("span", "usage-tick", compact(tick)));
    line.style.bottom = `${(tick / top) * 100}%`;
    return line;
  });
  const every = Math.ceil(periods.length / 7);
  const slots = periods.map((period, at) => slot(period, grain, top, at % every === 0 ? shortLabel(period.start, grain) : "", readout));
  return h("div", "usage-chart", h("div", "usage-plot", ...grid, h("div", "usage-columns", ...slots), readout));
}

/** One period's column. The whole slot, not just the column, takes the pointer and the focus. */
function slot(period: Period, grain: Grain, top: number, label: string, readout: HTMLElement): HTMLElement {
  const segments = SERIES.filter(([key]) => period.spent[key] > 0).map(([key]) => {
    const segment = h("div", `usage-segment series-${key}`);
    segment.style.flexGrow = String(period.spent[key]);
    return segment;
  });
  const column = h("div", "usage-column", ...segments);
  column.style.height = `${(totalOf(period.spent) / top) * 100}%`;
  const place = h("div", "usage-slot", h("div", "usage-bar", column), h("span", "usage-label", label));
  place.tabIndex = 0;
  place.setAttribute("aria-label", `${longLabel(period.start, grain)}: ${SERIES.map(([key, name]) => `${period.spent[key].toLocaleString()} ${name.toLowerCase()}`).join(", ")}`);
  const open = (): void => {
    readout.replaceChildren(h("p", "readout-title", longLabel(period.start, grain)), ...SERIES.map(([key, name]) => readoutRow(key, name, period.spent[key])));
    readout.hidden = false;
    // Over the column, but never past the chart's edges.
    const half = readout.offsetWidth / 2;
    const centre = place.offsetLeft + place.offsetWidth / 2;
    readout.style.left = `${Math.min(Math.max(centre, half), (readout.parentElement?.clientWidth ?? 0) - half)}px`;
  };
  const close = (): void => void (readout.hidden = true);
  place.addEventListener("pointerenter", open);
  place.addEventListener("focus", open);
  place.addEventListener("pointerleave", close);
  place.addEventListener("blur", close);
  return place;
}

// The value leads; a short stroke of the series' colour says which.
function readoutRow(key: keyof Usage, name: string, value: number): HTMLElement {
  return h("p", "readout-row", h("span", `line-key series-${key}`), h("strong", "", compact(value)), ` ${name.toLowerCase()}`);
}

/** The span's spending by model, provider or app, with the total and, for all time, what the ledger has no record of. */
function groupTable(calls: readonly ModelCall[], by: GroupBy, apps: readonly string[], since: number, missing?: Usage): HTMLElement {
  const groups = groupsOf(calls, by, since);
  const removed = (name: string): boolean => by === "app" && name !== UNNAMED && !apps.includes(name);
  const rows = groups.map(({ name, spent: used, calls: count }) => usageRow(removed(name) ? `${name} · removed` : name, used, count, ""));
  const all = sum(groups.map((group) => group.spent));
  if (missing !== undefined && totalOf(missing) > 0) rows.push(usageRow("Not in the ledger: apps removed or requests cut short before it was kept", missing, undefined, "quiet"));
  const total = missing === undefined ? all : addUsage(all, missing);
  const head = h("tr", "", ...["", "Calls", "In", "Out", "Thinking", "Total"].map((title) => h("th", "", title)));
  return h("table", "usage-table", h("thead", "", head), h("tbody", "", ...rows, usageRow("Total", total, groups.reduce((n, group) => n + group.calls, 0), "total")));
}

/** The chart's numbers, for reading without hovering. */
function periodTable(periods: readonly Period[], grain: Grain): HTMLElement {
  const rows = periods.filter((period) => period.calls > 0).map((period) => usageRow(longLabel(period.start, grain), period.spent, period.calls, ""));
  const head = h("tr", "", ...[grain === "day" ? "Day" : grain === "week" ? "Week" : "Month", "Calls", "In", "Out", "Thinking", "Total"].map((title) => h("th", "", title)));
  return h("details", "code", h("summary", "", `The numbers by ${grain}`), h("table", "usage-table", h("thead", "", head), h("tbody", "", ...rows)));
}

function usageRow(name: string, spent: Usage, calls: number | undefined, className: string): HTMLTableRowElement {
  const numbers = [calls, spent.input, spent.output, spent.thinking, totalOf(spent)].map((value) => h("td", "number", value === undefined ? "" : value.toLocaleString()));
  return h("tr", className, h("td", "", name), ...numbers);
}

function sum(usages: readonly Usage[]): Usage {
  return usages.reduce(addUsage, NO_USAGE);
}

function shortLabel(start: Date, grain: Grain): string {
  return start.toLocaleDateString(undefined, grain === "month" ? { month: "short" } : { month: "short", day: "numeric" });
}

function longLabel(start: Date, grain: Grain): string {
  if (grain === "month") return start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  if (grain === "week") return `Week of ${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  return start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function picker(options: readonly (readonly [string, string])[], chosen: string, name: string): HTMLSelectElement {
  const field = h("select", "", ...options.map(([value, label]) => new Option(label, value)));
  field.value = chosen;
  field.setAttribute("aria-label", name);
  return field;
}
