import { structuredPatch } from "diff";
import hljs from "highlight.js/lib/core";
import css from "highlight.js/lib/languages/css";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import { h } from "./dom.ts";

// TypeScript, and the HTML and CSS inside its html`` templates, which is most of an app.
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("css", css);

/** The code, highlighted. */
export function codeView(code: string, className: string): HTMLPreElement {
  const inner = h("code", "hljs");
  highlightInto(inner, code);
  return h("pre", className, inner);
}

/** Fills an element with the code, highlighted. */
export function highlightInto(target: HTMLElement, code: string): void {
  // The one place the page takes markup from a string. highlight.js escapes the code it is given,
  // and the page's CSP would stop any script regardless.
  target.innerHTML = hljs.highlight(code, { language: "typescript", ignoreIllegals: true }).value;
}

const LINE_CLASS: Readonly<Record<string, string>> = { "+": "diff-added", "-": "diff-removed", "\\": "diff-note" };

/** How one version of the code differs from another, the way git shows it, and how many lines each side gained. */
export function changes(before: string, after: string): { readonly view: HTMLElement; readonly added: number; readonly removed: number } {
  const { hunks } = structuredPatch("routes.ts", "routes.ts", before, after, undefined, undefined, { context: 3 });
  const lines = hunks.flatMap((hunk) => hunk.lines);
  const added = lines.filter((line) => line.startsWith("+")).length;
  const removed = lines.filter((line) => line.startsWith("-")).length;
  if (hunks.length === 0) return { view: h("p", "quiet", "The code is the same."), added, removed };
  const rows = hunks.flatMap((hunk) => [
    h("span", "diff-hunk", `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`),
    ...hunk.lines.map((line) => h("span", LINE_CLASS[line[0] ?? ""] ?? "", line)),
  ]);
  return { view: h("pre", "listing diff", ...rows), added, removed };
}
