import hljs from "highlight.js/lib/core";
import css from "highlight.js/lib/languages/css";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import { h } from "./dom.ts";
import { lineCount } from "./stages.ts";

// TypeScript, and the HTML and CSS inside its html`` templates, which is most of an app.
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("css", css);

/** The code, highlighted. */
export function codeView(code: string, className: string): HTMLPreElement {
  const inner = h("code", "hljs");
  // The one place the page takes markup from a string. highlight.js escapes the code it is given,
  // and the page's CSP would stop any script regardless.
  inner.innerHTML = hljs.highlight(code, { language: "typescript", ignoreIllegals: true }).value;
  return h("pre", className, inner);
}

/** The code behind a summary that opens it. */
export function codeDetails(code: string, open: boolean): HTMLDetailsElement {
  const details = h("details", "code", h("summary", "", `routes.ts · ${lineCount(code)} lines`), codeView(code, "listing"));
  details.open = open;
  return details;
}
