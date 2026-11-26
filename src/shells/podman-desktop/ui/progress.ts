import type { Progress } from "../messages.ts";
import { codeDetails, codeView } from "./code.ts";
import { h, keepTime } from "./dom.ts";
import { elapsed, lineCount, stagesOf, type Stage, type StageKind } from "./stages.ts";

const STAGES: Record<StageKind, (attempt: number) => readonly [icon: string, label: string]> = {
  writing: (attempt) => (attempt === 1 ? ["✍️", "Writing the code"] : ["🩹", `Fixing it · attempt ${attempt}`]),
  building: () => ["🔨", "Building the app"],
  trying: () => ["🧪", "Trying it out, cut off from the network"],
  deploying: () => ["🚀", "Starting it behind sign-in"],
};

// Stages already on screen, so only a new one slides in when the page is redrawn.
let shown = { since: 0, count: 0 };

/** What Mayfly is doing for a request: a clock, and a row for each stage. Behind the curtain, the code and what failed too. */
export function progressView({ since, steps }: Progress, title: string, peek: boolean): HTMLElement {
  const stages = stagesOf(steps);
  const seen = shown.since === since ? shown.count : 0;
  shown = { since, count: stages.length };
  const latestCode = stages.findLastIndex((stage) => stage.code !== undefined);
  const clock = h("span", "elapsed", elapsed(since, Date.now()));
  clock.dataset.since = String(since);
  const rows = stages.map((stage, index) => {
    const status = stage.problem !== undefined ? "failed" : index === stages.length - 1 ? "active" : "done";
    return stageItem(stage, status, { peek, isNew: index >= seen, codeOpen: index === latestCode });
  });
  return h("div", "progress", h("p", "progress-title", title), h("p", "quiet", clock, " · usually about a minute"), h("ol", "stages", ...rows));
}

/** Moves every clock on the page on to now. */
export function tickClocks(): void {
  for (const clock of document.querySelectorAll<HTMLElement>(".elapsed")) clock.textContent = elapsed(Number(clock.dataset.since), Date.now());
}

function stageItem(stage: Stage, status: "active" | "done" | "failed", options: { peek: boolean; isNew: boolean; codeOpen: boolean }): HTMLLIElement {
  const [icon, label] = STAGES[stage.kind](stage.attempt);
  const heading = h("p", "stage-label", label);
  if (status === "active") heading.append(h("span", "quiet", liveNote(stage)));
  if (status !== "active") heading.append(h("span", `stage-mark ${status}`, status === "done" ? "✓" : "✗"));
  const item = h("li", `stage ${status}`, keepTime(h("span", "stage-icon", icon)), h("div", "stage-body", heading, ...details(stage, options)));
  item.classList.toggle("new", options.isNew);
  return item;
}

// Reasoning models think before they write, and that thinking is not streamed. Saying so explains the wait.
function liveNote({ kind, code }: Stage): string {
  if (kind !== "writing") return "";
  if (code === undefined) return " · the model is thinking";
  return code === "" ? " · starting to write" : ` · ${lineCount(code)} lines`;
}

function details(stage: Stage, { peek, codeOpen }: { peek: boolean; codeOpen: boolean }): Node[] {
  const shown: Node[] = [];
  if (peek && stage.code !== undefined) shown.push(stage.live === true ? codeView(stage.code, "listing live") : codeDetails(stage.code, codeOpen));
  if (stage.problem !== undefined) shown.push(peek ? h("pre", "problem", stage.problem) : h("p", "quiet", "It didn't pass, so Mayfly is fixing it."));
  return shown;
}
