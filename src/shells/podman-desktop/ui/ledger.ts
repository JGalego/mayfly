import type { ModelCall } from "../../../engine/state.ts";
import { addUsage, NO_USAGE, type Usage } from "../../../engine/usage.ts";

export type Grain = "day" | "week" | "month";
export type GroupBy = "model" | "provider" | "app";

/** How far back to look, and in what steps. All time goes back to the first call, in months. */
export interface Span {
  readonly grain: Grain;
  readonly periods: number | "all";
}

/** A day, week or month, and what the calls in it spent. */
export interface Period {
  readonly start: Date;
  readonly spent: Usage;
  readonly calls: number;
}

/** A model, provider or app, and what its calls spent. */
export interface Group {
  readonly name: string;
  readonly spent: Usage;
  readonly calls: number;
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
  const periods: { start: Date; spent: Usage; calls: number }[] = [];
  for (let start = from; start <= now; start = step(grain, start, 1)) periods.push({ start, spent: NO_USAGE, calls: 0 });
  const index = new Map(periods.map((period, at) => [period.start.getTime(), at]));
  for (const call of calls) {
    const period = periods[index.get(startOf(grain, new Date(call.at)).getTime()) ?? -1];
    if (period === undefined) continue;
    period.spent = addUsage(period.spent, call.spent);
    period.calls++;
  }
  return periods;
}

/** What the calls since a moment spent, by model, provider or app, the most first. */
export function groupsOf(calls: readonly ModelCall[], by: GroupBy, since: number): Group[] {
  const groups = new Map<string, { name: string; spent: Usage; calls: number }>();
  for (const call of calls.filter((call) => call.at >= since)) {
    const name = by === "app" ? (call.app ?? UNNAMED) : call[by];
    const group = groups.get(name) ?? { name, spent: NO_USAGE, calls: 0 };
    groups.set(name, { name, spent: addUsage(group.spent, call.spent), calls: group.calls + 1 });
  }
  return [...groups.values()].sort((a, b) => totalOf(b.spent) - totalOf(a.spent));
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

/** Round steps for an axis that reaches past the largest value: 0, 2,500, 5,000 and so on. */
export function ticksFor(largest: number): number[] {
  if (largest <= 0) return [0];
  const rough = largest / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const size = [1, 2, 2.5, 5].map((step) => step * magnitude).find((step) => step >= rough) ?? 10 * magnitude;
  return Array.from({ length: Math.ceil(largest / size) + 1 }, (_, at) => at * size);
}

/** The start of the day, week (from Monday) or month holding a moment, in local time. */
export function startOf(grain: Grain, moment: Date): Date {
  const [year, month, day] = [moment.getFullYear(), moment.getMonth(), moment.getDate()];
  if (grain === "month") return new Date(year, month, 1);
  if (grain === "week") return new Date(year, month, day - ((moment.getDay() + 6) % 7));
  return new Date(year, month, day);
}

/** The start of the period some steps from this one. Dates, not milliseconds, so a clock change never shifts a day. */
function step(grain: Grain, start: Date, steps: number): Date {
  const [year, month, day] = [start.getFullYear(), start.getMonth(), start.getDate()];
  if (grain === "month") return new Date(year, month + steps, 1);
  return new Date(year, month, day + steps * (grain === "week" ? 7 : 1));
}
