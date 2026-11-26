import { ContractViolation } from "../core/contract-violation.ts";
import { parseAppName } from "../core/manifest.ts";

export type Parsed = { readonly ok: true; readonly name: string; readonly routes: string } | { readonly ok: false; readonly problem: string };

// The code comes in a fenced block, never inside JSON: models put raw newlines in JSON strings.
const NAME_LINE = /^name:\s*(.+?)\s*$/m;
const CODE_BLOCK = /```(?:ts|typescript)\n([\s\S]*?)\n```/;

/** Reads a model's reply, or says what is wrong with it in words the model can act on. */
export function parseReply(reply: string): Parsed {
  const name = NAME_LINE.exec(reply)?.[1];
  if (name === undefined) return problem("The reply has no `name:` line.");
  const nameProblem = problemWithName(name);
  if (nameProblem !== undefined) return problem(nameProblem);
  const code = CODE_BLOCK.exec(reply)?.[1];
  if (code === undefined) return problem("The reply has no complete ```ts block with the whole of routes.ts.");
  return { ok: true, name, routes: `${code}\n` };
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
