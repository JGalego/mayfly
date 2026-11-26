export type Level = "debug" | "info" | "warn" | "error";

/** One line of a log, read for a person: when, how serious, what it says, and anything else it carried. */
export interface LogLine {
  readonly at: string;
  readonly level: Level;
  readonly text: string;
  readonly extra: string;
}

const LEVELS: Readonly<Record<string, Level>> = { debug: "debug", info: "info", warn: "warn", warning: "warn", error: "error", fatal: "error" };

/**
 * Reads a line as Podman gives it, its timestamp first. Apps write JSON, as the contract says; Dex writes
 * key=value pairs; anything else is shown as it is.
 */
export function parseLogLine(raw: string): LogLine {
  const space = raw.indexOf(" ");
  const stamp = space === -1 ? "" : raw.slice(0, space);
  const at = Number.isNaN(Date.parse(stamp)) ? "" : stamp;
  const rest = at === "" ? raw : raw.slice(space + 1);
  return fromJson(at, rest) ?? fromPairs(at, rest) ?? { at, level: "info", text: rest, extra: "" };
}

function fromJson(at: string, text: string): LogLine | undefined {
  if (!text.startsWith("{")) return undefined;
  try {
    const { time: _time, level, msg, ...extra } = JSON.parse(text) as Record<string, unknown>;
    const rest = Object.keys(extra).length === 0 ? "" : JSON.stringify(extra);
    return { at, level: LEVELS[String(level)] ?? "info", text: typeof msg === "string" ? msg : text, extra: rest };
  } catch {
    return undefined;
  }
}

function fromPairs(at: string, text: string): LogLine | undefined {
  const level = /(?:^|\s)level=(\w+)/.exec(text)?.[1];
  if (level === undefined) return undefined;
  const msg = /(?:^|\s)msg="((?:[^"\\]|\\.)*)"/.exec(text)?.[1] ?? /(?:^|\s)msg=(\S+)/.exec(text)?.[1] ?? text;
  return { at, level: LEVELS[level.toLowerCase()] ?? "info", text: msg, extra: "" };
}

/** Whether a line is as serious as the person wants to see. */
export function atLeast(level: Level, wanted: Level): boolean {
  const order: readonly Level[] = ["debug", "info", "warn", "error"];
  return order.indexOf(level) >= order.indexOf(wanted);
}
