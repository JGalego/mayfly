import type { Usage } from "../../../engine/usage.ts";

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const COMPACT = new Intl.NumberFormat("en", { notation: "compact" });

/** A count the way people glance at it: 900, 3.4K, 21K, 12M. */
export function compact(count: number): string {
  return COMPACT.format(count);
}

export function tokens({ input, output, thinking }: Usage): string {
  const thought = thinking === 0 ? "" : `, ${compact(thinking)} thinking`;
  return `${compact(input)} tokens in, ${compact(output)} out${thought}`;
}

/** When something happened, the way people say it: "5 minutes ago", "yesterday". */
export function when(at: number, now = Date.now()): string {
  // Versions upgraded from before history was kept have no time.
  if (at === 0) return "before history was kept";
  const minutes = Math.round((at - now) / 60_000);
  if (Math.abs(minutes) < 60) return RELATIVE.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return RELATIVE.format(hours, "hour");
  return RELATIVE.format(Math.round(hours / 24), "day");
}
