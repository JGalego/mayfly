import { diffLines } from "diff";

/** How a line differs from the code the edit started from. "removed" means lines were removed just above it. */
export type LineMark = "added" | "changed" | "removed" | null;

/** One mark for each line of the edited code, for the editor's gutter. */
export function lineMarks(before: string, after: string): LineMark[] {
  const marks: LineMark[] = after.split("\n").map(() => null);
  const parts = diffLines(before, after);
  let line = 0;
  parts.forEach((part, index) => {
    if (part.removed) {
      if (parts[index + 1]?.added !== true) marks[line] = "removed";
      return;
    }
    if (part.added) marks.fill(parts[index - 1]?.removed === true ? "changed" : "added", line, line + part.count);
    line += part.count;
  });
  return marks;
}
