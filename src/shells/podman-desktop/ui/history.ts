import type { AppView, VersionView } from "../../../engine/engine.ts";
import { h } from "./dom.ts";
import { icon } from "./icons.ts";
import { tokens, when } from "./format.ts";
import { connection, graph, type GraphRow, type Lane } from "./graph.ts";
import { versionDetails, type Showing } from "./progress.ts";
import { changes } from "./code.ts";

type Status = "running" | "passed" | "failed";

const STATUS: Record<Status, string> = { running: "Running now", passed: "Passed", failed: "Failed" };
const MARK: Record<Status, string> = { running: "●", passed: "✓", failed: "✗" };

/** Every version of an app, newest first, as a graph of one line each. Picking one shows it in full beside the list. */
export function historyView(app: AppView, picked: string | undefined, pick: (version: string) => void): HTMLElement {
  const rows = graph(app.versions);
  const width = Math.max(1, ...rows.map((row) => row.lanes.length));
  return h("ol", "history", ...rows.map((row) => historyRow(app, row, width, row.version.id === picked, pick)));
}

/** What can be done with a version, when nothing else is under way: deploy it, or edit its code once it is fetched. */
export interface VersionActions {
  pick(version: string): void;
  close(): void;
  deploy?: (version: string) => void;
  edit?: (version: string) => void;
  /** The version picked to compare with, if any, and how to pick another. */
  readonly compare: { readonly with: string | undefined; choose(version: string | undefined): void };
}

/** One version in full: what was asked, how it went, who made it and when, what it cost and changed, and what can be done with it. */
export function versionPanel(app: AppView, version: VersionView, showing: Showing, actions: VersionActions): Node[] {
  const status = statusOf(app, version);
  const close = h("button", "quiet-button panel-close", icon("close"));
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", actions.close);
  const head = h("div", "panel-head", h("code", "version-id", version.id), h("span", `status-badge ${status}`, `${MARK[status]} ${STATUS[status]}`), close);
  const said = version.summary === "" ? [] : [h("p", "", version.summary)];
  const problem = version.problem === null ? [] : [h("pre", "problem", version.problem)];
  return [
    head,
    h("h2", "panel-title", version.request === "" ? "No request" : version.request),
    facts(version, actions.pick),
    ...said,
    ...problem,
    ...versionButtons(version, status, actions),
    ...versionDetails(app.name, version, showing, { changesOpen: true }),
    ...comparison(app, version, showing, actions.compare),
  ];
}

/** How this version differs from any other the person picks, on another branch or the one running, not only from its parent. */
function comparison(app: AppView, version: VersionView, showing: Showing, compare: VersionActions["compare"]): Node[] {
  const others = app.versions.filter((other) => other.id !== version.id && other.lines > 0).toReversed();
  if (others.length === 0) return [];
  const label = (other: VersionView): string => `${other.id}${other.id === app.head ? " · running" : ""} · ${other.request}`;
  const pick = h("select", "", new Option("Compare with another version…", ""), ...others.map((other) => new Option(label(other), other.id)));
  pick.value = compare.with ?? "";
  pick.setAttribute("aria-label", "Compare this version with another");
  pick.addEventListener("change", () => compare.choose(pick.value === "" ? undefined : pick.value));
  const base = others.find((other) => other.id === compare.with);
  if (base === undefined) return [h("p", "compare", pick)];
  const before = showing.code(app.name, base.id);
  const after = showing.code(app.name, version.id);
  const shown = before === undefined || after === undefined ? undefined : changes(before, after);
  const counts = shown === undefined ? [] : [h("span", "diff-added", `+${shown.added}`), h("span", "diff-removed", `−${shown.removed}`), h("span", "quiet", "from it to this one")];
  return [h("p", "compare", pick, ...counts), shown?.view ?? h("p", "quiet", "Loading code…")];
}

function historyRow(app: AppView, row: GraphRow, width: number, picked: boolean, pick: (version: string) => void): HTMLLIElement {
  const { version } = row;
  const status = statusOf(app, version);
  const byHand = version.by.kind === "person" ? [icon("pencil")] : [];
  const item = h(
    "button",
    "history-item",
    h("code", "version-id", version.id),
    h("span", "history-request", version.request === "" ? "No request" : version.request),
    h("span", "history-when with-icon", ...byHand, `${MARK[status]} ${when(version.at)}`),
  );
  item.type = "button";
  item.title = `${STATUS[status]}, by ${version.by.name}`;
  // Said in words, not the marks: "c3: Greet people by their first name. Passed, 25 minutes ago".
  item.setAttribute("aria-label", `${version.id}: ${version.request === "" ? "No request" : version.request}. ${STATUS[status]}, ${when(version.at)}`);
  item.setAttribute("aria-pressed", String(picked));
  item.addEventListener("click", () => pick(version.id));
  return h("li", `history-row ${status}${picked ? " picked" : ""}`, lanes(row, width), item);
}

function facts(version: VersionView, pick: (version: string) => void): HTMLElement {
  const made = h("span", "", ...(version.by.kind === "model" ? [icon("bot"), ` ${version.by.name}`] : [icon("pencil"), ` ${version.by.name}, by hand`]));
  const at = h("span", "", when(version.at));
  if (version.at !== 0) at.title = new Date(version.at).toLocaleString();
  const rows: [string, Node | string][] = [
    ["Made by", made],
    ["When", at],
    ["Based on", version.parent === null ? "None (first version)" : parentLink(version.parent, pick)],
  ];
  if (version.attempt > 1) rows.push(["Attempt", String(version.attempt)]);
  if (version.by.kind === "model") rows.push(["Tokens", tokens(version.spent)]);
  return h("dl", "facts", ...rows.flatMap(([term, value]) => [h("dt", "", term), h("dd", "", value)]));
}

function parentLink(parent: string, pick: (version: string) => void): HTMLButtonElement {
  const link = h("button", "link", h("code", "version-id", parent));
  link.type = "button";
  link.title = "Show parent version";
  link.addEventListener("click", () => pick(parent));
  return link;
}

// Any version with code can start an experiment; one that passed and is not running can be deployed. Nothing is lost either way.
function versionButtons(version: VersionView, status: Status, { deploy, edit }: VersionActions): Node[] {
  const buttons = [];
  if (status === "passed") buttons.push(button("primary", "rocket", "Deploy", "Replace the running version at the same address", deploy && (() => deploy(version.id))));
  if (version.lines > 0) buttons.push(button("secondary", "pencil", "Edit from here", "Use this version as the base for an edit", edit && (() => edit(version.id))));
  return buttons.length === 0 ? [] : [h("p", "panel-actions", ...buttons)];
}

function button(kind: string, name: "rocket" | "pencil", label: string, title: string, act: (() => void) | undefined): HTMLButtonElement {
  const control = h("button", `${kind} with-icon`, icon(name), label);
  control.type = "button";
  control.title = title;
  control.disabled = act === undefined;
  if (act !== undefined) control.addEventListener("click", act);
  return control;
}

function statusOf(app: AppView, version: VersionView): Status {
  return version.id === app.head ? "running" : version.problem === null ? "passed" : "failed";
}

function lanes({ lanes, tip, root }: GraphRow, width: number): HTMLElement {
  const cells = Array.from({ length: width }, (_, index): Lane => lanes[index] ?? "empty");
  const across = connection(cells);
  const drawn = h("span", "graph", ...cells.map((lane) => h("span", lane === "dot" ? `lane dot${tip ? " tip" : ""}${root ? " root" : ""}` : `lane ${lane}`)), ...(across === undefined ? [] : [acrossBar(across)]));
  // Only a picture of how versions branch; the row's label says what matters.
  drawn.setAttribute("aria-hidden", "true");
  return drawn;
}

/** The line across a row, from the lane of one end to the lane of the other. */
function acrossBar({ from, to }: { readonly from: number; readonly to: number }): HTMLElement {
  const bar = h("span", "lane-across");
  bar.style.setProperty("--from", String(from));
  bar.style.setProperty("--to", String(to));
  return bar;
}
