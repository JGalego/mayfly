import { format } from "node:util";

type Level = "debug" | "info" | "warn" | "error";

/** One JSON line on stdout, which is where the contract says every app logs. */
export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields })}\n`);
}

/** Generated code may write to the console, so the console writes JSON too. */
export function useJsonConsole(): void {
  console.log = console.info = (...args: unknown[]) => log("info", format(...args));
  console.debug = (...args: unknown[]) => log("debug", format(...args));
  console.warn = (...args: unknown[]) => log("warn", format(...args));
  console.error = (...args: unknown[]) => log("error", format(...args));
}
