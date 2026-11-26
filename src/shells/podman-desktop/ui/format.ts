import type { Usage } from "../../../engine/usage.ts";

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function tokens({ input, output, thinking }: Usage): string {
  const thought = thinking === 0 ? "" : `, ${thinking.toLocaleString()} thinking`;
  return `${input.toLocaleString()} tokens in, ${output.toLocaleString()} out${thought}`;
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
