/** A run of text in a paragraph: plain, code, bold or italic. */
export interface Inline {
  readonly kind: "text" | "code" | "strong" | "em";
  readonly text: string;
}

/** The part of Markdown models write in their replies: paragraphs, headings, lists and code. */
export type Block =
  | { readonly kind: "paragraph" | "heading"; readonly inline: readonly Inline[] }
  | { readonly kind: "list"; readonly ordered: boolean; readonly items: readonly (readonly Inline[])[] }
  | { readonly kind: "code"; readonly language: string; readonly text: string };

const FENCE = /^\s*```\s*(\S*)\s*$/;
const HEADING = /^#{1,6}\s+(.+)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const RUNS_ON = /^\s{2,}\S/;
// Code first, as nothing inside it is formatting. A mark must hug its text, so "2 * 3 * 4" and snake_case stay as they are.
const MARKS = /`([^`\n]+)`|\*\*([^*\s](?:[^*\n]*[^*\s])?)\*\*|(?<![\w*])\*([^*\s](?:[^*\n]*[^*\s])?)\*(?![\w*])|(?<![\w_])_([^_\s](?:[^_\n]*[^_\s])?)_(?![\w_])/g;

/** Reads a reply as blocks. A code fence not closed yet, as while the reply streams in, runs to the end. */
export function blocks(markdown: string): Block[] {
  const lines = markdown.split("\n");
  const read: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | undefined;
  const settle = (): void => {
    if (paragraph.length > 0) read.push({ kind: "paragraph", inline: inline(paragraph.join("\n")) });
    if (list !== undefined) read.push({ kind: "list", ordered: list.ordered, items: list.items.map(inline) });
    paragraph = [];
    list = undefined;
  };
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at] ?? "";
    const fence = FENCE.exec(line);
    if (fence !== null) {
      settle();
      const end = lines.findIndex((later, index) => index > at && /^\s*```\s*$/.test(later));
      const body = lines.slice(at + 1, end === -1 ? undefined : end);
      read.push({ kind: "code", language: fence[1] ?? "", text: body.join("\n") });
      at = end === -1 ? lines.length : end;
      continue;
    }
    if (line.trim() === "") {
      settle();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      settle();
      read.push({ kind: "heading", inline: inline(heading[1] ?? "") });
      continue;
    }
    const item = BULLET.exec(line) ?? NUMBERED.exec(line);
    if (item !== null) {
      const ordered = NUMBERED.test(line);
      if (list?.ordered !== ordered) settle();
      list ??= { ordered, items: [] };
      list.items.push(item[1] ?? "");
      continue;
    }
    if (list !== undefined && RUNS_ON.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    if (list !== undefined) settle();
    paragraph.push(line);
  }
  settle();
  return read;
}

/** Reads the code, bold and italics in a line of text. */
export function inline(text: string): Inline[] {
  const runs: Inline[] = [];
  let from = 0;
  for (const match of text.matchAll(MARKS)) {
    if (match.index > from) runs.push({ kind: "text", text: text.slice(from, match.index) });
    const [, code, strong, star, underscore] = match;
    if (code !== undefined) runs.push({ kind: "code", text: code });
    else if (strong !== undefined) runs.push({ kind: "strong", text: strong });
    else runs.push({ kind: "em", text: star ?? underscore ?? "" });
    from = match.index + match[0].length;
  }
  if (from < text.length || runs.length === 0) runs.push({ kind: "text", text: text.slice(from) });
  return runs;
}
