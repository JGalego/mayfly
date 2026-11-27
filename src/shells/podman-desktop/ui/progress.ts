import type { VersionView } from "../../../engine/engine.ts";
import type { Progress } from "../messages.ts";
import { changes, codeView } from "./code.ts";
import { h, keepTime } from "./dom.ts";
import { icon } from "./icons.ts";
import { elapsed, lineCount, stagesOf, stagesOfVersions, wordCount, type Stage, type StageKind } from "./stages.ts";

const STAGES: Record<StageKind, (attempt: number) => readonly [icon: string, label: string]> = {
  writing: (attempt) => (attempt === 1 ? ["✍️", "Writing code"] : ["🩹", `Revising code · attempt ${attempt}`]),
  edited: () => ["✏️", "Manual edit"],
  building: () => ["🔨", "Building image"],
  trying: () => ["🧪", "Testing without network access"],
  deploying: () => ["🚀", "Deploying behind sign-in"],
};

/** What each kind of work is called while it's under way. */
export const TITLES: Record<Exclude<Progress["kind"], "remove">, string> = { create: "Creating app", change: "Updating app", ask: "Answering", deploy: "Deploying", save: "Testing edit", rename: "Renaming", start: "Starting", restore: "Restoring data" };

/** What the page knows about showing things: whether to show code, which sections are open, and the code it has fetched. */
export interface Showing {
  readonly developer: boolean;
  isOpen(key: string, byDefault: boolean): boolean;
  setOpen(key: string, open: boolean): void;
  /** A version's code, or undefined while it is being fetched. */
  code(app: string, version: string): string | undefined;
  /** What the model thought writing a version, or undefined while it is being fetched. */
  thinking(app: string, version: string): string | undefined;
}

/** Where a stage's folds keep whether they are open, whether the latest one opens by default, and for a kept version, the app to fetch from. */
interface Folds {
  readonly key: string;
  readonly latest: boolean;
  readonly app?: string;
  /** Whether what it changed shows open until the person closes it. */
  readonly changesOpen?: boolean;
}

type Status = "active" | "done" | "failed";

// Stages already on screen, so only a new one slides in when the page is redrawn.
let shown = { since: 0, count: 0 };

export function progressView({ since, steps }: Progress, title: string, showing: Showing): HTMLElement {
  const stages = stagesOf(steps);
  const seen = shown.since === since ? shown.count : 0;
  shown = { since, count: stages.length };
  const latest = stages.findLastIndex((stage) => stage.code !== undefined || stage.thinking !== undefined);
  const clock = h("span", "elapsed", elapsed(since, Date.now()));
  clock.dataset.since = String(since);
  const rows = stages.map((stage, index) => {
    const status = stage.problem !== undefined ? "failed" : index === stages.length - 1 ? "active" : "done";
    const row = stageItem(stage, status, details(stage, showing, { key: `live:${since}:${stage.attempt}`, latest: index === latest }));
    row.classList.toggle("new", index >= seen);
    return row;
  });
  return h("div", "progress", h("p", "progress-title", title), h("p", "quiet", clock), h("ol", "stages", ...rows));
}

export function whatChanged(app: string, before: string, after: string, showing: Showing): HTMLDetailsElement {
  return diffFold(app, before, after, { key: `changed:${app}:${after}`, label: "What changed", open: false }, showing);
}

/** How a finished request was made, kept under its reply and folded away. */
export function makingOf(app: string, versions: readonly VersionView[], took: number, showing: Showing): HTMLDetailsElement {
  const attempts = versions.length === 1 ? "1 attempt" : `${versions.length} attempts`;
  const rows = stagesOfVersions(versions).map((stage) => {
    const folds = stage.version === undefined ? undefined : { key: `${app}:${stage.version}`, latest: false, app };
    return stageItem(stage, stage.problem === undefined ? "done" : "failed", details(stage, showing, folds));
  });
  const summary = h("summary", "", `Build details · ${attempts} · ${elapsed(0, took)}`);
  return disclosure(h("details", "making-of", summary, h("ol", "stages", ...rows)), `making:${app}:${versions[0]?.id ?? ""}`, false, showing);
}

/** A kept version's thinking, code, and changes from the version before. */
export function versionDetails(app: string, version: VersionView, showing: Showing, { changesOpen = false } = {}): Node[] {
  const parent = version.parent === null ? {} : { parent: version.parent };
  const { attempt, id, lines, thinkingWords } = version;
  const stage: Stage = { kind: "writing", attempt, version: id, lines, ...(thinkingWords === 0 ? {} : { thinkingWords }), ...parent };
  return details(stage, showing, { key: `${app}:${id}`, latest: false, app, changesOpen });
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

// Reasoning models think before they write, and most providers keep that thinking to themselves. Saying so explains the wait.
function liveNote({ kind, code }: Stage): string {
  if (kind !== "writing") return "";
  if (code === undefined) return " · the model is thinking";
  return code === "" ? " · starting to write" : ` · ${lineCount(code)} lines`;
}

function details(stage: Stage, showing: Showing, folds?: Folds): Node[] {
  const shown = showing.developer && folds !== undefined ? behindTheCurtain(stage, showing, folds) : [];
  if (stage.problem !== undefined) shown.push(showing.developer ? h("pre", "problem", stage.problem) : h("p", "quiet", "Attempt failed"));
  return shown;
}

function behindTheCurtain(stage: Stage, showing: Showing, folds: Folds): Node[] {
  const shown: Node[] = [];
  if (stage.thinking !== undefined || stage.thinkingWords !== undefined) shown.push(thinkingFold(stage, showing, folds));
  if (stage.code !== undefined && stage.live === true) shown.push(codeView(stage.code, "listing live"));
  else if (stage.code !== undefined || (stage.lines ?? 0) > 0) shown.push(codeFold(stage, showing, folds));
  if (folds.app !== undefined && stage.version !== undefined && stage.parent !== undefined) {
    const fold = { key: `diff:${folds.key}`, label: "Changes from the parent version", open: folds.changesOpen ?? false };
    shown.push(diffFold(folds.app, stage.parent, stage.version, fold, showing));
  }
  return shown;
}

/** What the model thought, open while it thinks and folded once it writes. A kept version's is fetched the first time it is opened. */
function thinkingFold(stage: Stage, showing: Showing, { key, latest, app }: Folds): HTMLDetailsElement {
  const stillThinking = stage.code === undefined && stage.problem === undefined && latest;
  const isOpen = showing.isOpen(`thinking:${key}`, stillThinking);
  const text = stage.thinking ?? (isOpen && app !== undefined && stage.version !== undefined ? showing.thinking(app, stage.version) : undefined);
  const words = stage.thinkingWords ?? wordCount(stage.thinking ?? "");
  const body = text === undefined ? h("p", "quiet", "Loading model reasoning…") : h("pre", stillThinking ? "thinking live" : "thinking", text);
  const summary = h("summary", "", icon("thinking"), ` The model's thinking · ${words.toLocaleString()} words`);
  return disclosure(h("details", "code", summary, body), `thinking:${key}`, stillThinking, showing);
}

/** A stage's code, folded under its length. A kept version's code is fetched the first time it is opened. */
function codeFold(stage: Stage, showing: Showing, { key, latest, app }: Folds): HTMLDetailsElement {
  const isOpen = showing.isOpen(`code:${key}`, latest);
  const code = stage.code ?? (isOpen && app !== undefined && stage.version !== undefined ? showing.code(app, stage.version) : undefined);
  const lines = stage.lines ?? (stage.code === undefined ? 0 : lineCount(stage.code));
  const body = code === undefined ? h("p", "quiet", "Loading code…") : codeView(code, "listing");
  return disclosure(h("details", "code", h("summary", "", `routes.ts · ${lines} lines`), body), `code:${key}`, latest, showing);
}

/** Two versions' differences, fetched the first time the fold is opened. */
function diffFold(app: string, before: string, after: string, { key, label, open }: { key: string; label: string; open: boolean }, showing: Showing): HTMLDetailsElement {
  const isOpen = showing.isOpen(key, open);
  const old = isOpen ? showing.code(app, before) : undefined;
  const now = isOpen ? showing.code(app, after) : undefined;
  const shown = old === undefined || now === undefined ? undefined : changes(old, now);
  const summary = h("summary", "", label);
  if (shown !== undefined) summary.append(" · ", h("span", "diff-added", `+${shown.added}`), " ", h("span", "diff-removed", `−${shown.removed}`));
  return disclosure(h("details", "code", summary, shown?.view ?? h("p", "quiet", "Loading code…")), key, open, showing);
}

/** Keeps a fold open or closed across redraws, as the person left it. */
function disclosure(fold: HTMLDetailsElement, key: string, byDefault: boolean, showing: Showing): HTMLDetailsElement {
  fold.open = showing.isOpen(key, byDefault);
  fold.addEventListener("toggle", () => {
    if (fold.open !== showing.isOpen(key, byDefault)) showing.setOpen(key, fold.open);
  });
  return fold;
}
