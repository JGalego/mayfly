import type { ServiceHealth } from "../../../engine/engine.ts";
import type { Activity, FromUi } from "../messages.ts";
import { h } from "./dom.ts";
import { matches, parseLogLine, type Level, type LogLine } from "./log-lines.ts";

// Mayfly's own activity, picked like any container's logs.
const MAYFLY = "mayfly";

const LEVELS: readonly [Level, string][] = [
  ["debug", "Everything"],
  ["info", "Info and up"],
  ["warn", "Warnings and errors"],
  ["error", "Errors only"],
];

const AGES: readonly [number, string][] = [
  [0, "Any time"],
  [300_000, "Last 5 minutes"],
  [3_600_000, "Last hour"],
  [86_400_000, "Last day"],
];

/** A log reader: whose logs, how serious, how recent, containing what, and room to read them all. */
export interface LogViewer {
  readonly element: HTMLElement;
  /** Offers each container of these services, and Mayfly's activity when the viewer has it, keeping the one chosen. */
  offer(services: readonly ServiceHealth[]): void;
  ask(): void;
  receiveLogs(pod: string, container: string, lines: readonly string[]): void;
  receiveActivity(entries: readonly Activity[]): void;
}

export function logViewer(post: (message: FromUi) => void, { activity }: { activity: boolean }): LogViewer {
  let lines: readonly LogLine[] | undefined;
  const source = h("select", "log-source");
  const level = select(LEVELS, "info");
  const since = select(AGES, 3_600_000);
  const search = h("input", "log-search");
  const count = h("p", "quiet log-count");
  const list = h("ol", "log-lines");
  const refresh = button("Refresh");
  const expand = button("Expand");
  const element = h(
    "section",
    "log-viewer",
    h("div", "section-head", h("h2", "", "Logs"), h("div", "", refresh, expand)),
    h("p", "hint", "Mayfly's own activity, and what each app and the sign-in service wrote."),
    h("div", "log-controls", source, level, since, search),
    count,
    list,
  );
  source.setAttribute("aria-label", "Log source");
  level.setAttribute("aria-label", "Minimum log level");
  since.setAttribute("aria-label", "Time range");
  search.type = "search";
  search.placeholder = "Find…";
  search.setAttribute("aria-label", "Search logs");
  if (activity) source.append(new Option("Mayfly activity", MAYFLY));

  const show = (): void => {
    const age = Number(since.value);
    const filter = { level: level.value as Level, since: age === 0 ? 0 : Date.now() - age, text: search.value };
    const shown = (lines ?? []).filter((line) => matches(line, filter));
    const empty = lines === undefined ? "Loading logs…" : lines.length === 0 ? "No logs yet." : "No matching lines.";
    count.textContent = lines === undefined || lines.length === 0 ? "" : `${shown.length} of ${lines.length} lines`;
    list.replaceChildren(...(shown.length === 0 ? [h("li", "quiet", empty)] : shown.map(lineItem)));
    list.scrollTop = list.scrollHeight;
  };
  const ask = (): void => {
    lines = undefined;
    show();
    if (source.value === MAYFLY) return post({ type: "activity" });
    const [pod = "", container = ""] = source.value.split("/");
    if (pod !== "") post({ type: "logs", pod, container });
  };
  // Expanded, the logs fill the page for reading a lot of them, until closed.
  const setExpanded = (expanded: boolean): void => {
    element.classList.toggle("expanded", expanded);
    expand.textContent = expanded ? "Close" : "Expand";
    expand.setAttribute("aria-expanded", String(expanded));
    show();
  };

  source.addEventListener("change", ask);
  for (const filter of [level, since]) filter.addEventListener("change", show);
  search.addEventListener("input", show);
  refresh.addEventListener("click", ask);
  expand.addEventListener("click", () => setExpanded(!element.classList.contains("expanded")));
  document.addEventListener("keydown", (event) => event.key === "Escape" && setExpanded(false));

  return {
    element,
    ask,
    offer(services) {
      const chosen = source.value;
      const before = source.value;
      const containers = services.flatMap((service) => service.containers.map((container) => new Option(`${service.name} · ${container.name}`, `${service.pod}/${container.name}`)));
      source.replaceChildren(...(activity ? [new Option("Mayfly activity", MAYFLY)] : []), ...containers);
      if ([...source.options].some((option) => option.value === chosen)) source.value = chosen;
      // Containers turning up for the first time are worth reading straight away.
      if (before === "" && source.value !== "") ask();
    },
    // Each viewer takes only the logs it asked for.
    receiveLogs(pod, container, raw) {
      if (source.value !== `${pod}/${container}`) return;
      lines = raw.map(parseLogLine);
      show();
    },
    receiveActivity(entries) {
      if (source.value !== MAYFLY) return;
      lines = entries.map(({ at, level: severity, text }) => ({ at: new Date(at).toISOString(), level: severity, text, extra: "" }));
      show();
    },
  };
}

function select<T extends string | number>(options: readonly [T, string][], chosen: T): HTMLSelectElement {
  const field = h("select", "", ...options.map(([value, label]) => new Option(label, String(value))));
  field.value = String(chosen);
  return field;
}

function button(label: string): HTMLButtonElement {
  const control = h("button", "quiet-button", label);
  control.type = "button";
  return control;
}

// Built from text only, like the rest of the page: a log line can hold anything an app wrote.
function lineItem({ at, level, text, extra }: LogLine): HTMLLIElement {
  const time = at === "" ? "" : new Date(at).toLocaleTimeString();
  return h("li", `log-line ${level}`, h("span", "log-time", time), h("span", "log-level", level), h("span", "log-text", text, extra === "" ? "" : ` ${extra}`));
}
