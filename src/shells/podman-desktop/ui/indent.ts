const STEP = "  ";

/** What Tab or Shift+Tab does to the code: the stretch to replace, what goes there, and where the selection is then. */
export interface Indented {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Tab puts two spaces at the caret, or indents every line of a selection that spans lines. Shift+Tab outdents the lines the caret
 * or selection touches by up to two spaces or a tab. A selection that ends at the very start of a line leaves that line alone.
 */
export function indent(code: string, start: number, end: number, outdent: boolean): Indented {
  if (!outdent && !code.slice(start, end).includes("\n")) return { from: start, to: end, text: STEP, start: start + STEP.length, end: start + STEP.length };
  const from = code.lastIndexOf("\n", start - 1) + 1;
  const last = end > start && code[end - 1] === "\n" ? end - 1 : end;
  const lineEnd = code.indexOf("\n", last);
  const to = lineEnd === -1 ? code.length : lineEnd;
  const lines = code.slice(from, to).split("\n");
  const changed = lines.map((line) => (outdent ? line.replace(/^(?: {1,2}|\t)/, "") : STEP + line));
  const text = changed.join("\n");
  const first = (changed[0]?.length ?? 0) - (lines[0]?.length ?? 0);
  return { from, to, text, start: Math.max(from, start + first), end: Math.max(from, end + text.length - (to - from)) };
}
