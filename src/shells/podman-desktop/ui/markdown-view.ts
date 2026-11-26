import { nameChip } from "./chips.ts";
import { codeView } from "./code.ts";
import { h } from "./dom.ts";
import { blocks, type Block, type Inline } from "./markdown.ts";

/** A reply written in Markdown, built from text nodes, so nothing in it can become markup. Inline code shows as a chip. */
export function markdownView(text: string): HTMLElement[] {
  return blocks(text).map(blockView);
}

function blockView(block: Block): HTMLElement {
  switch (block.kind) {
    case "paragraph":
      return h("p", "", ...block.inline.map(inlineView));
    case "heading":
      return h("p", "md-heading", ...block.inline.map(inlineView));
    case "list":
      return h(block.ordered ? "ol" : "ul", "md-list", ...block.items.map((item) => h("li", "", ...item.map(inlineView))));
    case "code":
      return codeView(block.text, "listing", block.language);
  }
}

function inlineView({ kind, text }: Inline): Node | string {
  if (kind === "code") return nameChip(text);
  if (kind === "strong") return h("strong", "", text);
  if (kind === "em") return h("em", "", text);
  return text;
}
