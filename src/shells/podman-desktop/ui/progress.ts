import type { VersionView } from "../../../engine/engine.ts";
import type { Progress } from "../messages.ts";
import { changes, codeView } from "./code.ts";
import { h, keepTime } from "./dom.ts";
import { elapsed, lineCount, stagesOf, stagesOfVersions, type Stage, type StageKind } from "./stages.ts";

const STAGES: Record<StageKind, (attempt: number) => readonly [icon: string, label: string]> = {
  writing: (attempt) => (attempt === 1 ? ["✍️", "Writing the code"] : ["🩹", `Fixing it · attempt ${attempt}`]),
  building: () => ["🔨", "Building the app"],
  trying: () => ["🧪", "Trying it out, cut off from the network"],
  deploying: () => ["🚀", "Starting it behind sign-in"],
};

/** What the page knows about showing things: whether to show code, which sections are open, and the code it has fetched. */
export interface Showing {
  readonly peek: boolean;
  isOpen(key: string, byDefault: boolean): boolean;
  setOpen(key: string, open: boolean): void;
  /** A version's code, or undefined while it is being fetched. */
  code(app: string, version: string): string | undefined;
}

type Status = "active" | "done" | "failed";

// Stages already on screen, so only a new one slides in when the page is redrawn.
let shown = { since: 0, count: 0 };

/** What Mayfly is doing for a request: a clock, and a row for each stage. Behind the curtain, the code and what failed too. */
export function progressView({ since, steps }: Progress, title: string, showing: Showing): HTMLElement {
  const stages = stagesOf(steps);
  const seen = shown.since === since ? shown.count : 0;
  shown = { since, count: stages.length };
  const latestCode = stages.findLastIndex((stage) => stage.code !== undefined);
  const clock = h("span", "elapsed", elapsed(since, Date.now()));
  clock.dataset.since = String(since);
  const rows = stages.map((stage, index) => {
    const status = stage.problem !== undefined ? "failed" : index === stages.length - 1 ? "active" : "done";
    const row = stageItem(stage, status, details(stage, showing, { key: `live:${since}:${stage.attempt}`, open: index === latestCode }));
    row.classList.toggle("new", index >= seen);
    return row;
  });
  return h("div", "progress", h("p", "progress-title", title), h("p", "quiet", clock, " · usually about a minute"), h("ol", "stages", ...rows));
}

/** Behind the curtain, what a request changed in the app: from the version running before it to the one it made. */
export function whatChanged(app: string, before: string, after: string, showing: Showing): HTMLDetailsElement {
  return diffFold(app, before, after, { key: `changed:${app}:${after}`, label: "What changed" }, showing);
}

/** How a finished request was made, kept under its reply and folded away. */
export function makingOf(app: string, versions: readonly VersionView[], took: number, showing: Showing): HTMLDetailsElement {
  const attempts = versions.length === 1 ? "1 attempt" : `${versions.length} attempts`;
  const rows = stagesOfVersions(versions).map((stage) => {
    const code = stage.version === undefined ? undefined : { key: `code:${app}:${stage.version}`, open: false, app };
    return stageItem(stage, stage.problem === undefined ? "done" : "failed", details(stage, showing, code));
  });
  const summary = h("summary", "", `How it was made · ${attempts} · ${elapsed(0, took)}`);
  return disclosure(h("details", "making-of", summary, h("ol", "stages", ...rows)), `making:${app}:${versions[0]?.id ?? ""}`, false, showing);
}

/** Moves every clock on the page on to now. */
export function tickClocks(): void {
  for (const clock of document.querySelectorAll<HTMLElement>(".elapsed")) clock.textContent = elapsed(Number(clock.dataset.since), Date.now());
}

function stageItem(stage: Stage, status: Status, extras: readonly Node[]): HTMLLIElement {
  const [icon, label] = STAGES[stage.kind](stage.attempt);
  const heading = h("p", "stage-label", label);
  if (status === "active") heading.append(h("span", "quiet", liveNote(stage)));
  else heading.append(h("span", `stage-mark ${status}`, status === "done" ? "✓" : "✗"));
  return h("li", `stage ${status}`, keepTime(h("span", "stage-icon", icon)), h("div", "stage-body", heading, ...extras));
}

// Reasoning models think before they write, and that thinking is not streamed. Saying so explains the wait.
function liveNote({ kind, code }: Stage): string {
  if (kind !== "writing") return "";
  if (code === undefined) return " · the model is thinking";
  return code === "" ? " · starting to write" : ` · ${lineCount(code)} lines`;
}

/** The code and the problem a stage shows. Code shows behind the curtain only. */
function details(stage: Stage, showing: Showing, code?: { key: string; open: boolean; app?: string }): Node[] {
  const shown: Node[] = [];
  if (showing.peek && stage.code !== undefined && stage.live === true) shown.push(codeView(stage.code, "listing live"));
  else if (showing.peek && code !== undefined && (stage.code !== undefined || stage.version !== undefined)) shown.push(codeFold(stage, showing, code));
  if (showing.peek && code?.app !== undefined && stage.version !== undefined && stage.parent !== undefined) {
    shown.push(diffFold(code.app, stage.parent, stage.version, { key: `diff:${code.app}:${stage.version}`, label: "Changes from the version before" }, showing));
  }
  if (stage.problem !== undefined) shown.push(showing.peek ? h("pre", "problem", stage.problem) : h("p", "quiet", "It didn't pass, so Mayfly tried again."));
  return shown;
}

/** A stage's code, folded under its length. A kept version's code is fetched the first time it is opened. */
function codeFold(stage: Stage, showing: Showing, { key, open, app }: { key: string; open: boolean; app?: string }): HTMLDetailsElement {
  const isOpen = showing.isOpen(key, open);
  const code = stage.code ?? (isOpen && app !== undefined && stage.version !== undefined ? showing.code(app, stage.version) : undefined);
  const lines = stage.lines ?? (stage.code === undefined ? 0 : lineCount(stage.code));
  const body = code === undefined ? h("p", "quiet", "Fetching the code…") : codeView(code, "listing");
  return disclosure(h("details", "code", h("summary", "", `routes.ts · ${lines} lines`), body), key, open, showing);
}

/** Two versions' differences, fetched the first time the fold is opened. */
function diffFold(app: string, before: string, after: string, { key, label }: { key: string; label: string }, showing: Showing): HTMLDetailsElement {
  const isOpen = showing.isOpen(key, false);
  const old = isOpen ? showing.code(app, before) : undefined;
  const now = isOpen ? showing.code(app, after) : undefined;
  const shown = old === undefined || now === undefined ? undefined : changes(old, now);
  const summary = h("summary", "", label);
  if (shown !== undefined) summary.append(" · ", h("span", "diff-added", `+${shown.added}`), " ", h("span", "diff-removed", `−${shown.removed}`));
  return disclosure(h("details", "code", summary, shown?.view ?? h("p", "quiet", "Fetching the code…")), key, false, showing);
}

/** Keeps a fold open or closed across redraws, as the person left it. */
function disclosure(fold: HTMLDetailsElement, key: string, byDefault: boolean, showing: Showing): HTMLDetailsElement {
  fold.open = showing.isOpen(key, byDefault);
  fold.addEventListener("toggle", () => {
    if (fold.open !== showing.isOpen(key, byDefault)) showing.setOpen(key, fold.open);
  });
  return fold;
}
