import { nameChip } from "./chips.ts";
import { codeView } from "./code.ts";
import { h } from "./dom.ts";
import { blocks, type Block, type Inline } from "./markdown.ts";

/** Opens a link's page in the person's browser. */
export type Opener = (url: string) => void;

/** A reply written in Markdown, built from text nodes, so nothing in it can become markup. Inline code shows as a chip. */
export function markdownView(text: string, open: Opener): HTMLElement[] {
  return blocks(text).map((block) => blockView(block, open));
}

function blockView(block: Block, open: Opener): HTMLElement {
  const runs = (inline: readonly Inline[]): (Node | string)[] => inline.map((run) => inlineView(run, open));
  switch (block.kind) {
    case "paragraph":
      return h("p", "", ...runs(block.inline));
    case "heading":
      return h("p", "md-heading", ...runs(block.inline));
    case "quote":
      return h("blockquote", "md-quote", ...runs(block.inline));
    case "list":
      return h(block.ordered ? "ol" : "ul", "md-list", ...block.items.map((item) => h("li", "", ...runs(item))));
    case "table":
      return h(
        "table",
        "md-table",
        h("thead", "", h("tr", "", ...block.head.map((cell) => h("th", "", ...runs(cell))))),
        h("tbody", "", ...block.rows.map((row) => h("tr", "", ...row.map((cell) => h("td", "", ...runs(cell)))))),
      );
    case "code":
      return codeView(block.text, "listing", block.language);
  }
}

function inlineView(run: Inline, open: Opener): Node | string {
  if (run.kind === "code") return nameChip(run.text);
  if (run.kind === "strong") return h("strong", "", run.text);
  if (run.kind === "em") return h("em", "", run.text);
  if (run.kind === "link") return link(run.text, run.url, open);
  return run.text;
}

// A button, not an anchor: the page cannot open anything itself. Where it leads shows on hover, before anyone clicks.
function link(text: string, url: string, open: Opener): HTMLButtonElement {
  const button = h("button", "link", text);
  button.type = "button";
  button.title = url;
  button.addEventListener("click", () => open(url));
  return button;
}
