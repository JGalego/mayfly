import type { ModelCall } from "../../../engine/state.ts";
import { addUsage, NO_USAGE, type Usage } from "../../../engine/usage.ts";

export type Grain = "minute" | "hour" | "day" | "week" | "month";
export type GroupBy = "model" | "provider" | "app";

/** The app, model and provider whose calls to look at, each "" for all of them. */
export type Filter = Readonly<Record<GroupBy, string>>;

/** How far back to look, and in what steps. All time goes back to the first call, in months. */
export interface Span {
  readonly grain: Grain;
  readonly periods: number | "all";
}

/** What some calls spent, how many wrote code that passed its trial and how many code that failed, and the middle of the times they took. Calls whose outcome or time is unknown count in neither. */
export interface Tally {
  readonly spent: Usage;
  readonly calls: number;
  readonly passed: number;
  readonly failed: number;
  readonly took: number | null;
}

/** A minute, hour, day, week or month, and its calls' tally. */
export interface Period extends Tally {
  readonly start: Date;
}

/** A model, provider or app, and its calls' tally. */
export interface Group extends Tally {
  readonly name: string;
}

/** What a call made for a new app that failed before it had a name was for. */
export const UNNAMED = "New apps that never got a name";

/** When a span starts: its first period's start, or for all time, the month of the first call with a known time. */
export function spanStart({ grain, periods }: Span, calls: readonly ModelCall[], now: Date): Date {
  if (periods === "all") return startOf("month", new Date(calls.find((call) => call.at > 0)?.at ?? now.getTime()));
  return step(grain, startOf(grain, now), 1 - periods);
}

/** Each period from the one starting at `from` to the one holding `now`, with what the calls in it spent. */
export function periodsOf(calls: readonly ModelCall[], grain: Grain, from: Date, now: Date): Period[] {
  const starts: Date[] = [];
  for (let start = from; start <= now; start = step(grain, start, 1)) starts.push(start);
  const byStart = Map.groupBy(calls, (call) => startOf(grain, new Date(call.at)).getTime());
  return starts.map((start) => ({ start, ...tallyOf(byStart.get(start.getTime()) ?? []) }));
}

/** What the calls since a moment spent, by model, provider or app, the most first. */
export function groupsOf(calls: readonly ModelCall[], by: GroupBy, since: number): Group[] {
  const groups = Map.groupBy(calls.filter((call) => call.at >= since), (call) => nameIn(call, by));
  return [...groups].map(([name, mine]) => ({ name, ...tallyOf(mine) })).sort((a, b) => totalOf(b.spent) - totalOf(a.spent));
}

export function tallyOf(calls: readonly ModelCall[]): Tally {
  const spent = calls.reduce((sum, call) => addUsage(sum, call.spent), NO_USAGE);
  const passed = calls.filter((call) => call.passed === true).length;
  const failed = calls.filter((call) => call.passed === false).length;
  return { spent, calls: calls.length, passed, failed, took: middleOf(calls.flatMap((call) => call.took ?? [])) };
}

/** The calls for the app, model and provider picked. */
export function filtered(calls: readonly ModelCall[], filter: Filter): ModelCall[] {
  const keys = (["app", "model", "provider"] as const).filter((key) => filter[key] !== "");
  return calls.filter((call) => keys.every((key) => nameIn(call, key) === filter[key]));
}

/** Every app, model and provider the calls are for, in order, to pick from. */
export function choicesOf(calls: readonly ModelCall[]): Record<GroupBy, string[]> {
  const names = (key: GroupBy): string[] => [...new Set(calls.map((call) => nameIn(call, key)))].sort((a, b) => a.localeCompare(b));
  return { app: names("app"), model: names("model"), provider: names("provider") };
}

function nameIn(call: ModelCall, key: GroupBy): string {
  return key === "app" ? (call.app ?? UNNAMED) : call[key];
}

// The median: one slow call must not make a model look slow.
function middleOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[half] ?? null) : ((sorted[half - 1] ?? 0) + (sorted[half] ?? 0)) / 2;
}

/** What was spent that the ledger cannot say where: on apps removed, or requests cut short, before it was kept. */
export function unrecorded(spent: Usage, calls: readonly ModelCall[]): Usage {
  const recorded = calls.reduce((sum, call) => addUsage(sum, call.spent), NO_USAGE);
  const left = (key: keyof Usage): number => Math.max(0, spent[key] - recorded[key]);
  return { input: left("input"), output: left("output"), thinking: left("thinking") };
}

export function totalOf({ input, output, thinking }: Usage): number {
  return input + output + thinking;
}

/** Round steps, none smaller than the least, for an axis that reaches past the largest value: 0, 2,500, 5,000 and so on. */
export function ticksFor(largest: number, least = 0): number[] {
  if (largest <= 0) return [0];
  const rough = largest / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const size = Math.max(least, [1, 2, 2.5, 5].map((step) => step * magnitude).find((step) => step >= rough) ?? 10 * magnitude);
  return Array.from({ length: Math.ceil(largest / size) + 1 }, (_, at) => at * size);
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** The start of the minute, hour, day, week (from Monday) or month holding a moment, in local time. */
export function startOf(grain: Grain, moment: Date): Date {
  // Taken off the moment itself, not rebuilt from the clock, so an hour the clock repeats stays an hour of its own.
  const intoMinute = moment.getSeconds() * 1000 + moment.getMilliseconds();
  if (grain === "minute") return new Date(moment.getTime() - intoMinute);
  if (grain === "hour") return new Date(moment.getTime() - moment.getMinutes() * MINUTE - intoMinute);
  const [year, month, day] = [moment.getFullYear(), moment.getMonth(), moment.getDate()];
  if (grain === "month") return new Date(year, month, 1);
  if (grain === "week") return new Date(year, month, day - ((moment.getDay() + 6) % 7));
  return new Date(year, month, day);
}

/** The start of the period some steps from this one. Minutes and hours pass in milliseconds; days and longer go by the
 * calendar, so a clock change never shifts a day. */
function step(grain: Grain, start: Date, steps: number): Date {
  if (grain === "minute" || grain === "hour") return new Date(start.getTime() + steps * (grain === "minute" ? MINUTE : HOUR));
  const [year, month, day] = [start.getFullYear(), start.getMonth(), start.getDate()];
  if (grain === "month") return new Date(year, month + steps, 1);
  return new Date(year, month, day + steps * (grain === "week" ? 7 : 1));
}
