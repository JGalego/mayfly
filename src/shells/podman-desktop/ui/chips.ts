import { h } from "./dom.ts";

// One line between single backticks, as Mayfly writes an app's name in the conversation and models write code.
const BACKTICKED = /(?<!`)`([^`\n]+)`(?!`)/g;

/** Text cut where backticks set something apart. */
export function spans(text: string): { readonly text: string; readonly chip: boolean }[] {
  const parts: { text: string; chip: boolean }[] = [];
  let from = 0;
  for (const match of text.matchAll(BACKTICKED)) {
    if (match.index > from) parts.push({ text: text.slice(from, match.index), chip: false });
    parts.push({ text: match[1] ?? "", chip: true });
    from = match.index + match[0].length;
  }
  if (from < text.length || parts.length === 0) parts.push({ text: text.slice(from), chip: false });
  return parts;
}

/** An app's name, set apart from the words around it, in a dialog or in the conversation. */
export function nameChip(name: string): HTMLElement {
  return h("code", "name-chip", name);
}

/** Text as nodes, with what backticks set apart as chips. */
export function withChips(text: string): (Node | string)[] {
  return spans(text).map((span) => (span.chip ? nameChip(span.text) : span.text));
}
