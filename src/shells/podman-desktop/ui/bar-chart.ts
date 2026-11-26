import { h } from "./dom.ts";
import { compact } from "./format.ts";
import { ticksFor } from "./ledger.ts";

/** A series: the class that colours it, `series-<key>`, and its name. */
export interface Series {
  readonly key: string;
  readonly name: string;
}

/** A column: the label under it, or none, its name in full, and a value for each series, bottom first. */
export interface Column {
  readonly label: string;
  readonly title: string;
  readonly values: readonly number[];
}

/** Which colour is which, with each one's total, so the legend doubles as the summary; then a note in quiet text. */
export function legend(series: readonly Series[], totals: readonly number[], note: string): HTMLElement {
  const items = series.map(({ key, name }, at) => h("span", "legend-item", h("span", `swatch series-${key}`), `${name} `, h("strong", "", compact(totals[at] ?? 0))));
  return h("p", "usage-legend", ...items, h("span", "quiet", note));
}

/** A column per period, its series stacked, with round ticks behind and a readout on hover or focus. Counts tick in whole numbers. */
export function barChart(columns: readonly Column[], series: readonly Series[], { counts = false } = {}): HTMLElement {
  const ticks = ticksFor(Math.max(...columns.map((column) => sumOf(column.values))), counts ? 1 : 0);
  const top = ticks.at(-1) ?? 1;
  const readout = h("div", "usage-readout");
  readout.hidden = true;
  const grid = ticks.map((tick) => {
    const line = h("div", "usage-grid", h("span", "usage-tick", compact(tick)));
    line.style.bottom = `${(tick / top) * 100}%`;
    return line;
  });
  const slots = columns.map((column) => slot(column, series, top, readout));
  return h("div", "usage-chart", h("div", "usage-plot", ...grid, h("div", "usage-columns", ...slots), readout));
}

/** One column. The whole slot, not just the column, takes the pointer and the focus. */
function slot({ label, title, values }: Column, series: readonly Series[], top: number, readout: HTMLElement): HTMLElement {
  const segments = series.flatMap(({ key }, at) => {
    const value = values[at] ?? 0;
    if (value <= 0) return [];
    const segment = h("div", `usage-segment series-${key}`);
    segment.style.flexGrow = String(value);
    return [segment];
  });
  const column = h("div", "usage-column", ...segments);
  column.style.height = `${(sumOf(values) / top) * 100}%`;
  const place = h("div", "usage-slot", h("div", "usage-bar", column), h("span", "usage-label", label));
  place.tabIndex = 0;
  place.setAttribute("aria-label", `${title}: ${series.map(({ name }, at) => `${(values[at] ?? 0).toLocaleString()} ${name.toLowerCase()}`).join(", ")}`);
  const open = (): void => {
    readout.replaceChildren(h("p", "readout-title", title), ...series.map(({ key, name }, at) => readoutRow(key, name, values[at] ?? 0)));
    readout.hidden = false;
    // Over the column, but never past the chart's edges.
    const half = readout.offsetWidth / 2;
    const centre = place.offsetLeft + place.offsetWidth / 2;
    readout.style.left = `${Math.min(Math.max(centre, half), (readout.parentElement?.clientWidth ?? 0) - half)}px`;
  };
  const close = (): void => void (readout.hidden = true);
  place.addEventListener("pointerenter", open);
  place.addEventListener("focus", open);
  place.addEventListener("pointerleave", close);
  place.addEventListener("blur", close);
  return place;
}

// The value leads; a short stroke of the series' colour says which.
function readoutRow(key: string, name: string, value: number): HTMLElement {
  return h("p", "readout-row", h("span", `line-key series-${key}`), h("strong", "", compact(value)), ` ${name.toLowerCase()}`);
}

function sumOf(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}
