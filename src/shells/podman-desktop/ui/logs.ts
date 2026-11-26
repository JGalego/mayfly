import type { ServiceHealth } from "../../../engine/engine.ts";
import type { Activity, FromUi } from "../messages.ts";
import { h } from "./dom.ts";
import { atLeast, parseLogLine, type Level, type LogLine } from "./log-lines.ts";

// Mayfly's own activity, picked like any container's logs.
const MAYFLY = "mayfly";

const source = element<HTMLSelectElement>("log-source");
const level = element<HTMLSelectElement>("log-level");

let lines: readonly LogLine[] | undefined;

/** Wires the Logs section of Settings: choosing whose logs, how serious, and asking again. */
export function setUpLogs(post: (message: FromUi) => void): void {
  const ask = (): void => askLogs(post);
  source.addEventListener("change", ask);
  level.addEventListener("change", showLines);
  element("refresh-logs").addEventListener("click", ask);
}

export function askLogs(post: (message: FromUi) => void): void {
  lines = undefined;
  showLines();
  const [pod = "", container = ""] = source.value.split("/");
  post(source.value === MAYFLY || source.value === "" ? { type: "activity" } : { type: "logs", pod, container });
}

/** Offers Mayfly's activity and every container Podman knows, keeping the one chosen. */
export function offerSources(services: readonly ServiceHealth[]): void {
  const chosen = source.value || MAYFLY;
  const containers = services.flatMap((service) => service.containers.map((container) => new Option(`${service.name} · ${container.name}`, `${service.pod}/${container.name}`)));
  source.replaceChildren(new Option("Mayfly's activity", MAYFLY), ...containers);
  source.value = [...source.options].some((option) => option.value === chosen) ? chosen : MAYFLY;
}

export function receiveLogs(raw: readonly string[]): void {
  lines = raw.map(parseLogLine);
  showLines();
}

export function receiveActivity(entries: readonly Activity[]): void {
  lines = entries.map(({ at, level: severity, text }) => ({ at: new Date(at).toISOString(), level: severity, text, extra: "" }));
  showLines();
}

function showLines(): void {
  const list = element("log-lines");
  const wanted = level.value as Level;
  const shown = (lines ?? []).filter((line) => atLeast(line.level, wanted));
  const empty = lines === undefined ? "Fetching…" : lines.length === 0 ? "Nothing yet." : "Nothing this serious.";
  list.replaceChildren(...(shown.length === 0 ? [h("li", "quiet", empty)] : shown.map(lineItem)));
  list.scrollTop = list.scrollHeight;
}

// Built from text only, like the rest of the page: a log line can hold anything an app wrote.
function lineItem({ at, level: severity, text, extra }: LogLine): HTMLLIElement {
  const time = at === "" ? "" : new Date(at).toLocaleTimeString();
  return h("li", `log-line ${severity}`, h("span", "log-time", time), h("span", "log-level", severity), h("span", "log-text", text, extra === "" ? "" : ` ${extra}`));
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
