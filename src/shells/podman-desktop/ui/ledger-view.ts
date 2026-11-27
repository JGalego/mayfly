import type { ModelCall } from "../../../engine/state.ts";
import { addUsage, type Usage } from "../../../engine/usage.ts";
import { barChart, legend, type Column, type Series } from "./bar-chart.ts";
import { h } from "./dom.ts";
import { choicesOf, filtered, groupsOf, periodsOf, spanStart, tallyOf, totalOf, UNNAMED, unrecorded, type Filter, type Grain, type GroupBy, type Period, type Span, type Tally } from "./ledger.ts";
import { elapsed } from "./stages.ts";

const SPANS: readonly [string, string, Span][] = [
  ["minutes", "Last hour", { grain: "minute", periods: 60 }],
  ["hours", "Last 24 hours", { grain: "hour", periods: 24 }],
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

const FILTERS: readonly [GroupBy, string][] = [
  ["app", "All apps"],
  ["model", "All models"],
  ["provider", "All providers"],
];

// Bottom to top in each column, and in the legend's order.
const TOKENS: readonly Series[] = [
  { key: "input", name: "Tokens in" },
  { key: "output", name: "Tokens out" },
  { key: "thinking", name: "Thinking" },
];

const OUTCOMES: readonly Series[] = [
  { key: "passed", name: "Passed" },
  { key: "failed", name: "Failed" },
];

const COLUMNS = ["Calls", "In", "Out", "Thinking", "Total", "Passed", "Median time"];

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

/** How the models did and when: a span and the calls to look at, then charts of their tokens and attempts, and the same as tables. */
export function ledgerView(): LedgerView {
  const span = picker(SPANS.map(([value, label]) => [value, label]), "days", "Time range");
  const filters = Object.fromEntries(FILTERS.map(([key, all]) => [key, picker([["", all]], "", all)])) as Record<GroupBy, HTMLSelectElement>;
  const grouping = picker(GROUPINGS, "model", "Group by");
  const body = h("div", "ledger-body");
  let shown: { calls: readonly ModelCall[] | undefined; context: Context; key: string } | undefined;
  const render = (): void => {
    if (shown === undefined) return;
    if (shown.calls === undefined) return void body.replaceChildren(h("p", "quiet", "Loading usage…"));
    offer(filters, choicesOf(shown.calls));
    const chosen = SPANS.find(([value]) => value === span.value)?.[2] ?? { grain: "day", periods: 14 };
    const filter: Filter = { app: filters.app.value, model: filters.model.value, provider: filters.provider.value };
    body.replaceChildren(...ledgerBody(shown.calls, shown.context, chosen, filter, grouping));
  };
  for (const control of [span, grouping, ...Object.values(filters)]) control.addEventListener("change", render);
  return {
    element: h("div", "ledger", h("div", "log-controls", span, ...Object.values(filters)), body),
    show(calls, context) {
      const key = JSON.stringify([calls?.length, context]);
      if (shown !== undefined && shown.calls === calls && shown.key === key) return;
      shown = { calls, context, key };
      render();
    },
  };
}

/** Each filter offers what the calls name, keeping what was picked while there is still such a call. */
function offer(filters: Record<GroupBy, HTMLSelectElement>, choices: Record<GroupBy, string[]>): void {
  for (const [key, all] of FILTERS) {
    const field = filters[key];
    const kept = choices[key].includes(field.value) ? field.value : "";
    field.replaceChildren(new Option(all, ""), ...choices[key].map((name) => new Option(name, name)));
    field.value = kept;
  }
}

function ledgerBody(every: readonly ModelCall[], context: Context, span: Span, filter: Filter, grouping: HTMLSelectElement): Node[] {
  const now = new Date();
  const from = spanStart(span, every, now);
  const calls = filtered(every, filter);
  const since = span.periods === "all" ? 0 : from.getTime();
  const inSpan = calls.filter((call) => call.at >= since);
  if (inSpan.length === 0) return [h("p", "quiet", "No model calls match these filters.")];
  const periods = periodsOf(calls, span.grain, from, now);
  const unfiltered = Object.values(filter).every((value) => value === "");
  // What the ledger has no record of belongs to no app, model or provider it can name.
  const missing = span.periods === "all" && unfiltered ? unrecorded(context.spent, every) : undefined;
  return [
    h("h3", "usage-heading", "Tokens"),
    ...tokens(periods, span.grain, inSpan),
    h("h3", "usage-heading", "Trial results"),
    ...attempts(periods, span.grain, inSpan),
    h("div", "usage-heading table-head", h("h3", "", "Totals"), grouping),
    groupTable(inSpan, grouping.value as GroupBy, context.apps, missing),
    periodTable(periods, span.grain),
  ];
}

function tokens(periods: readonly Period[], grain: Grain, calls: readonly ModelCall[]): Node[] {
  const { spent } = tallyOf(calls);
  const count = `${calls.length.toLocaleString()} ${calls.length === 1 ? "call" : "calls"}`;
  return [legend(TOKENS, [spent.input, spent.output, spent.thinking], count), barChart(columnsOf(periods, grain, ({ spent: used }) => [used.input, used.output, used.thinking]), TOKENS)];
}

function attempts(periods: readonly Period[], grain: Grain, calls: readonly ModelCall[]): Node[] {
  const { passed, failed } = tallyOf(calls);
  const known = passed + failed;
  if (known === 0) return [h("p", "quiet", "No recorded trial results.")];
  // Answers to questions wrote no code, so they have no outcome to miss.
  const unknown = calls.filter((call) => call.passed === undefined && call.question !== true).length;
  const notes = [`${Math.round((passed / known) * 100)}% passed`, ...(unknown === 0 ? [] : [`${unknown.toLocaleString()} more with no known outcome`])];
  return [legend(OUTCOMES, [passed, failed], notes.join(" · ")), barChart(columnsOf(periods, grain, (period) => [period.passed, period.failed]), OUTCOMES, { counts: true })];
}

// Labels under at most seven columns, so they never run into each other.
function columnsOf(periods: readonly Period[], grain: Grain, values: (period: Period) => number[]): Column[] {
  const every = Math.ceil(periods.length / 7);
  return periods.map((period, at) => ({ label: at % every === 0 ? shortLabel(period.start, grain) : "", title: longLabel(period.start, grain), values: values(period) }));
}

/** The span's calls by model, provider or app, with the total and, for all time, what the ledger has no record of. */
function groupTable(calls: readonly ModelCall[], by: GroupBy, apps: readonly string[], missing?: Usage): HTMLElement {
  const groups = groupsOf(calls, by, 0);
  const removed = (name: string): boolean => by === "app" && name !== UNNAMED && !apps.includes(name);
  const rows = groups.map((group) => usageRow(removed(group.name) ? `${group.name} · removed` : group.name, group, ""));
  const total = tallyOf(calls);
  if (missing === undefined || totalOf(missing) === 0) return table("", [...rows, usageRow("Total", total, "total")]);
  rows.push(usageRow("Unrecorded token usage", { spent: missing }, "quiet"));
  return table("", [...rows, usageRow("Total", { ...total, spent: addUsage(total.spent, missing) }, "total")]);
}

/** The charts' numbers, for reading without hovering. */
function periodTable(periods: readonly Period[], grain: Grain): HTMLElement {
  const rows = periods.filter((period) => period.calls > 0).map((period) => usageRow(longLabel(period.start, grain), period, ""));
  return h("details", "code", h("summary", "", `Usage by ${grain}`), table(`${grain[0]?.toUpperCase()}${grain.slice(1)}`, rows));
}

function table(first: string, rows: readonly HTMLTableRowElement[]): HTMLTableElement {
  const head = h("tr", "", ...[first, ...COLUMNS].map((title) => h("th", "", title)));
  return h("table", "usage-table", h("thead", "", head), h("tbody", "", ...rows));
}

/** A row of the tables. Passes count only calls whose outcome is known, and the time is the middle one, as a clock reads. */
function usageRow(name: string, tally: Partial<Tally> & Pick<Tally, "spent">, className: string): HTMLTableRowElement {
  const { spent, calls, passed = 0, failed = 0, took = null } = tally;
  const known = passed + failed;
  const cells = [calls?.toLocaleString() ?? "", ...[spent.input, spent.output, spent.thinking, totalOf(spent)].map((n) => n.toLocaleString()), known === 0 ? "" : `${passed} of ${known}`, took === null ? "" : elapsed(0, took)];
  return h("tr", className, h("td", "", name), ...cells.map((cell) => h("td", "number", cell)));
}

function shortLabel(start: Date, grain: Grain): string {
  if (grain === "minute" || grain === "hour") return start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return start.toLocaleDateString(undefined, grain === "month" ? { month: "short" } : { month: "short", day: "numeric" });
}

function longLabel(start: Date, grain: Grain): string {
  if (grain === "minute" || grain === "hour") return start.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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
