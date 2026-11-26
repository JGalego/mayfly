import type { VersionView } from "../../../engine/engine.ts";
import type { Step } from "../../../engine/step.ts";

export type StageKind = "writing" | "building" | "trying" | "deploying";

/** One thing Mayfly does while it makes an app, and how it went. */
export interface Stage {
  readonly kind: StageKind;
  readonly attempt: number;
  /** The code the model wrote, or has written so far while `live`. */
  readonly code?: string;
  readonly live?: boolean;
  /** The kept version whose code this is, for a finished request, and its length. The code itself is fetched when wanted. */
  readonly version?: string;
  readonly lines?: number;
  readonly problem?: string;
}

/** Groups the engine's steps into the stages a person sees. */
export function stagesOf(steps: readonly Step[]): Stage[] {
  const stages: Stage[] = [];
  let attempt = 1;
  const amendLast = (change: Partial<Stage>): void => {
    const last = stages.pop();
    if (last !== undefined) stages.push({ ...last, ...change });
  };
  for (const step of steps) {
    switch (step.kind) {
      case "writing":
        attempt = step.attempt;
        stages.push({ kind: "writing", attempt });
        break;
      case "draft":
        amendLast({ code: codeIn(step.text), live: true });
        break;
      case "wrote":
        amendLast({ code: step.routes, live: false });
        break;
      case "failed":
        amendLast({ problem: step.problem });
        break;
      default:
        stages.push({ kind: step.kind, attempt });
    }
  }
  return stages;
}

/** The code in a reply the model is still writing: after the opening fence, up to the closing one. */
export function codeIn(reply: string): string {
  const start = /```(?:ts|typescript)\n/.exec(reply);
  if (start === null) return "";
  const code = reply.slice(start.index + start[0].length);
  const end = code.indexOf("\n```");
  return end === -1 ? code : code.slice(0, end + 1);
}

export function lineCount(code: string): number {
  return code.split("\n").length - (code.endsWith("\n") ? 1 : 0);
}

/** Minutes and seconds since a moment, like 1:05. */
export function elapsed(since: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The stages of a finished request, rebuilt from the versions it made. */
export function stagesOfVersions(versions: readonly VersionView[]): Stage[] {
  const stages: Stage[] = [];
  for (const { id, attempt, lines, problem } of versions) {
    if (lines === 0) {
      stages.push({ kind: "writing", attempt, problem: problem ?? "" });
      continue;
    }
    stages.push({ kind: "writing", attempt, version: id, lines }, { kind: "building", attempt });
    stages.push(problem === null ? { kind: "trying", attempt } : { kind: "trying", attempt, problem });
  }
  const last = versions.at(-1);
  if (last?.problem === null) stages.push({ kind: "deploying", attempt: last.attempt });
  return stages;
}
