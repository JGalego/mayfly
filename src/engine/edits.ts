/** A change to code: the exact lines to find, and the lines to put in their place. */
export interface Edit {
  readonly search: string;
  readonly replace: string;
}

export type Applied = { readonly ok: true; readonly routes: string } | { readonly ok: false; readonly problem: string };

/** Applies edits in order. Each must match exactly one place, so an edit never lands somewhere the model did not mean. */
export function applyEdits(routes: string, edits: readonly Edit[]): Applied {
  let result = routes;
  for (const [index, { search, replace }] of edits.entries()) {
    const matches = result.split(search).length - 1;
    if (matches !== 1) return { ok: false, problem: problemWith(index + 1, matches) };
    // A function, so a "$" in the code is never read as a replacement pattern.
    result = result.replace(search, () => replace);
  }
  return { ok: true, routes: result };
}

function problemWith(edit: number, matches: number): string {
  if (matches === 0) return `The SEARCH lines of edit ${edit} are not in routes.ts. Copy them exactly as they are, indentation included.`;
  return `The SEARCH lines of edit ${edit} appear ${matches} times in routes.ts. Include more lines around them, so they match one place.`;
}
