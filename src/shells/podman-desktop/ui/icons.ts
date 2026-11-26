/** A shape in an icon: an SVG element and its attributes, on a 24-point grid. */
type Shape = readonly [tag: "path" | "circle" | "ellipse" | "rect", attributes: Readonly<Record<string, string | number>>];

const path = (d: string): Shape => ["path", { d }];
const circle = (cx: number, cy: number, r: number): Shape => ["circle", { cx, cy, r }];

// One style for every icon: lines 2 points wide with round ends, in the colour of the text beside them.
const ICONS = {
  bot: [["rect", { x: 4, y: 8, width: 16, height: 12, rx: 3 }], path("M12 8V4"), circle(12, 3, 1), path("M9 13v2M15 13v2")],
  check: [path("M5 12.5l4.5 4.5L19 7")],
  close: [path("M6 6l12 12M18 6L6 18")],
  code: [path("M8 7l-5 5 5 5M16 7l5 5-5 5")],
  coins: [["ellipse", { cx: 12, cy: 6, rx: 7, ry: 3 }], path("M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6")],
  conversation: [path("M21 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z")],
  copy: [["rect", { x: 8, y: 8, width: 12, height: 12, rx: 2 }], path("M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2")],
  external: [path("M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5")],
  history: [circle(6, 6, 2), circle(6, 18, 2), circle(18, 6, 2), path("M6 8v8M18 8v5a5 5 0 0 1-5 5H8")],
  key: [circle(8, 15, 4), path("M11 12l9-9M16 7l3 3M14 9l2 2")],
  logs: [path("M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01")],
  pencil: [path("M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"), path("M13.5 6.5l4 4")],
  plus: [path("M12 5v14M5 12h14")],
  rewind: [path("M3.5 12a8.5 8.5 0 1 0 2.5-6"), path("M3 4v4h4"), path("M12 8v4l3 2")],
  rocket: [path("M12 2c3 2.5 4 6 4 10v4H8v-4c0-4 1-7.5 4-10z"), circle(12, 10, 1.5), path("M8 13l-3 3v3l3-1M16 13l3 3v3l-3-1M10.5 19.5L12 22l1.5-2.5")],
  settings: [
    ["circle", { cx: 12, cy: 12, r: 8, "stroke-width": 3, "stroke-dasharray": "3.14 3.14", "stroke-linecap": "butt" }],
    circle(12, 12, 6),
    circle(12, 12, 2.5),
  ],
  sliders: [path("M4 6h8M16 6h4M4 12h2M10 12h10M4 18h10M18 18h2"), circle(14, 6, 2), circle(8, 12, 2), circle(16, 18, 2)],
  star: [path("M12 3l2.8 5.8 6.2.8-4.5 4.3 1.1 6.2L12 17.2l-5.6 2.9 1.1-6.2L3 9.6l6.2-.8z")],
  thinking: [["ellipse", { cx: 13, cy: 9, rx: 8, ry: 5.5 }], circle(6.5, 17, 1.6), circle(4, 20.5, 0.8)],
} satisfies Record<string, readonly Shape[]>;

export type IconName = keyof typeof ICONS;

const SVG = "http://www.w3.org/2000/svg";

/** An icon, drawn from shapes rather than markup, and hidden from screen readers, which read the label beside it. */
export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attributes] of ICONS[name]) {
    const shape = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, String(value));
    svg.append(shape);
  }
  return svg;
}

/** Gives each element the page marks with `data-icon` its icon before its label, or after it for `data-icon-after`. */
export function addIcons(root: ParentNode): void {
  for (const element of root.querySelectorAll<HTMLElement>("[data-icon], [data-icon-after]")) {
    const { icon: before, iconAfter: after } = element.dataset;
    if (isIcon(before)) element.prepend(icon(before));
    if (isIcon(after)) element.append(icon(after));
  }
}

function isIcon(name: string | undefined): name is IconName {
  return name !== undefined && Object.hasOwn(ICONS, name);
}
