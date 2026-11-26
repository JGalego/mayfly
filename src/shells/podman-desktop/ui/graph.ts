import type { VersionView } from "../../../engine/engine.ts";

/** What a lane holds in one row of the graph: nothing, a line passing by, the row's version, or a branch ending at it. */
export type Lane = "empty" | "line" | "dot" | "join";

/** One row of the history graph, the way `git log --graph` draws it. */
export interface GraphRow {
  readonly version: VersionView;
  readonly lanes: readonly Lane[];
  /** No newer version starts from this one in its lane, so no line comes down to it. */
  readonly tip: boolean;
  /** It starts from no version, so no line leaves it. */
  readonly root: boolean;
}

/** Lays out versions newest first. Each branch keeps a lane until it reaches the version it started from. */
export function graph(versions: readonly VersionView[]): GraphRow[] {
  // Each lane waits for the version its line leads down to.
  const waiting: (string | null)[] = [];
  const rows: GraphRow[] = [];
  for (const version of [...versions].reverse()) {
    const found = waiting.indexOf(version.id);
    const lane = found === -1 ? freeLane(waiting) : found;
    const lanes = waiting.map((id, index): Lane => (index === lane ? "dot" : id === version.id ? "join" : id === null ? "empty" : "line"));
    for (const [index, id] of waiting.entries()) if (id === version.id) waiting[index] = null;
    waiting[lane] = version.parent;
    rows.push({ version, lanes, tip: found === -1, root: version.parent === null });
  }
  return rows;
}

function freeLane(waiting: (string | null)[]): number {
  const free = waiting.indexOf(null);
  return free === -1 ? waiting.push(null) - 1 : free;
}
