/** A run of text in a paragraph: plain, code, bold, italic, or a link to a web page. */
export type Inline = { readonly kind: "text" | "code" | "strong" | "em"; readonly text: string } | { readonly kind: "link"; readonly text: string; readonly url: string };

type Cells = readonly (readonly Inline[])[];

/** The part of Markdown models write in their replies: paragraphs, headings, quotes, lists, tables and code. */
export type Block =
  | { readonly kind: "paragraph" | "heading" | "quote"; readonly inline: readonly Inline[] }
  | { readonly kind: "list"; readonly ordered: boolean; readonly items: Cells }
  | { readonly kind: "table"; readonly head: Cells; readonly rows: readonly Cells[] }
  | { readonly kind: "code"; readonly language: string; readonly text: string };

const FENCE = /^\s*```\s*(\S*)\s*$/;
const HEADING = /^#{1,6}\s+(.+)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const RUNS_ON = /^\s{2,}\S/;
const QUOTE = /^\s*>\s?(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
// Code first, as nothing inside it is formatting. A mark must hug its text, so "2 * 3 * 4" and snake_case stay as they are.
const MARKS = /`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|<(https?:\/\/[^\s>]+)>|\*\*([^*\s](?:[^*\n]*[^*\s])?)\*\*|(?<![\w*])\*([^*\s](?:[^*\n]*[^*\s])?)\*(?![\w*])|(?<![\w_])_([^_\s](?:[^_\n]*[^_\s])?)_(?![\w_])/g;

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
    const next = lines[at + 1] ?? "";
    if (line.includes("|") && TABLE_RULE.test(next)) {
      settle();
      let end = at + 2;
      while (end < lines.length && (lines[end] ?? "").includes("|") && (lines[end] ?? "").trim() !== "") end++;
      read.push({ kind: "table", head: cells(line), rows: lines.slice(at + 2, end).map(cells) });
      at = end - 1;
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote !== null) {
      settle();
      const quoted = [quote[1] ?? ""];
      while (QUOTE.test(lines[at + 1] ?? "")) quoted.push(QUOTE.exec(lines[++at] ?? "")?.[1] ?? "");
      read.push({ kind: "quote", inline: inline(quoted.join("\n")) });
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

/** A table row's cells, without the pipes at either end. */
function cells(row: string): Inline[][] {
  return row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => inline(cell.trim()));
}

/** Reads the code, links, bold and italics in a line of text. Only links to web pages count: anything else stays text. */
export function inline(text: string): Inline[] {
  const runs: Inline[] = [];
  let from = 0;
  for (const match of text.matchAll(MARKS)) {
    if (match.index > from) runs.push({ kind: "text", text: text.slice(from, match.index) });
    const [, code, label, url, bare, strong, star, underscore] = match;
    if (code !== undefined) runs.push({ kind: "code", text: code });
    else if (url !== undefined) runs.push({ kind: "link", text: label ?? url, url });
    else if (bare !== undefined) runs.push({ kind: "link", text: bare, url: bare });
    else if (strong !== undefined) runs.push({ kind: "strong", text: strong });
    else runs.push({ kind: "em", text: star ?? underscore ?? "" });
    from = match.index + match[0].length;
  }
  if (from < text.length || runs.length === 0) runs.push({ kind: "text", text: text.slice(from) });
  return runs;
}
