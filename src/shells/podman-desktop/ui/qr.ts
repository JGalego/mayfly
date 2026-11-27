import { encode } from "uqr";

const SVG = "http://www.w3.org/2000/svg";
// Scanners need a light margin around the code.
const BORDER = 2;

/** A QR code as one SVG path: a unit square for each dark module, and the code's side, border included. */
export function qrModules(text: string): { readonly size: number; readonly path: string } {
  const { data } = encode(text, { border: BORDER });
  const squares = data.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : [])));
  return { size: data.length, path: squares.join("") };
}

/** A QR code of the text that a phone's camera opens, labelled for people who can't see it. */
export function qrCode(text: string, label: string): SVGSVGElement {
  const { size, path } = qrModules(text);
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "qr");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  // Crisp edges: modules are squares, and blurred ones scan worse.
  svg.setAttribute("shape-rendering", "crispEdges");
  const modules = document.createElementNS(SVG, "path");
  modules.setAttribute("d", path);
  svg.append(modules);
  return svg;
}
