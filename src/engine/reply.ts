import { ContractViolation } from "../core/contract-violation.ts";
import { parseAppName } from "../core/manifest.ts";
import type { Edit } from "./edits.ts";

/** The whole of routes.ts, or edits to the routes.ts there is. */
export type Code = { readonly routes: string } | { readonly edits: readonly Edit[] };

export type Parsed = { readonly ok: true; readonly name: string; readonly code: Code; readonly summary: string } | { readonly ok: false; readonly problem: string };

// The code comes in a fenced block, never inside JSON: models put raw newlines in JSON strings.
const NAME_LINE = /^name:\s*(.+?)\s*$/m;
const CODE_BLOCK = /```(?:ts|typescript)\n([\s\S]*?)\n```/;
const EDIT = /^<{7} SEARCH\n([\s\S]*?)^={7}\n([\s\S]*?)^>{7} REPLACE$/gm;

/** Reads a model's reply, or says what is wrong with it in words the model can act on. */
export function parseReply(reply: string): Parsed {
  const name = NAME_LINE.exec(reply)?.[1];
  if (name === undefined) return problem("The reply has no `name:` line.");
  const nameProblem = problemWithName(name);
  if (nameProblem !== undefined) return problem(nameProblem);
  // Edits come first: a model sometimes fences them as if they were code.
  const edits = [...reply.matchAll(EDIT)];
  const lastEdit = edits.at(-1);
  if (lastEdit !== undefined) {
    const code = { edits: edits.map(([, search = "", replace = ""]) => ({ search, replace })) };
    return { ok: true, name, code, summary: after(reply, lastEdit) };
  }
  const block = CODE_BLOCK.exec(reply);
  if (block === null) return problem("The reply has no complete ```ts block with the whole of routes.ts, and no edits.");
  return { ok: true, name, code: { routes: `${block[1]}\n` }, summary: after(reply, block) };
}

// What follows the code is for the person. Without it the app still works, so it is never a problem.
function after(reply: string, match: RegExpExecArray | RegExpMatchArray): string {
  return reply.slice((match.index ?? 0) + match[0].length).replace(/^\s*```\s*/, "").trim();
}

function problemWithName(name: string): string | undefined {
  try {
    parseAppName(name);
    return undefined;
  } catch (error) {
    if (error instanceof ContractViolation) return `The name is not usable: ${error.message}.`;
    throw error;
  }
}

function problem(text: string): Parsed {
  return { ok: false, problem: text };
}
