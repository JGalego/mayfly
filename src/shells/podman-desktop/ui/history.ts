import type { AppView, VersionView } from "../../../engine/engine.ts";
import { h } from "./dom.ts";
import { tokens, when } from "./format.ts";
import { graph, type GraphRow, type Lane } from "./graph.ts";
import { versionDetails, type Showing } from "./progress.ts";

type Status = "running" | "passed" | "failed";

const STATUS: Record<Status, string> = { running: "✓ running now", passed: "✓ passed", failed: "✗ failed" };

/** Every version of an app, newest first, as a graph: which one runs, what was asked for, when, and what it cost. */
export function historyView(app: AppView, showing: Showing, { restore, busy }: { restore(version: string): void; busy: boolean }): HTMLElement {
  const rows = graph(app.versions);
  const width = Math.max(1, ...rows.map((row) => row.lanes.length));
  return h("ol", "history", ...rows.map((row) => historyRow(app, row, width, showing, busy ? undefined : restore)));
}

function historyRow(app: AppView, row: GraphRow, width: number, showing: Showing, restore?: (version: string) => void): HTMLLIElement {
  const { version } = row;
  const status: Status = version.id === app.head ? "running" : version.problem === null ? "passed" : "failed";
  const title = h("p", "history-title", h("code", "version-id", version.id), " ", version.request === "" ? "No request" : version.request);
  const cost = version.by.kind === "model" ? [tokens(version.spent)] : [];
  const facts = h("p", "quiet", [STATUS[status], `by ${version.by.name}`, when(version.at), ...cost].join(" · "));
  const problem = version.problem === null ? [] : [showing.developer ? h("pre", "problem", version.problem) : h("p", "quiet", version.problem.split("\n")[0] ?? "")];
  const body = h("div", "history-body", title, facts, ...problem, ...versionDetails(app.name, version, showing));
  return h("li", `history-row ${status}`, lanes(row, width), body, ...action(version, status, restore));
}

function lanes({ lanes, tip, root }: GraphRow, width: number): HTMLElement {
  const cells = Array.from({ length: width }, (_, index): Lane => lanes[index] ?? "empty");
  return h("span", "graph", ...cells.map((lane) => h("span", lane === "dot" ? `lane dot${tip ? " tip" : ""}${root ? " root" : ""}` : `lane ${lane}`)));
}

function action(version: VersionView, status: Status, restore?: (version: string) => void): Node[] {
  if (status !== "passed") return [];
  const button = h("button", "quiet-button go-back", "Go back to this");
  button.type = "button";
  button.disabled = restore === undefined;
  button.title = "Run this version again. Your next change starts from it, and nothing is lost.";
  button.addEventListener("click", () => restore?.(version.id));
  return [button];
}
