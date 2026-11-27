import { ContractViolation } from "./contract-violation.ts";
import { SIGN_IN } from "./names.ts";
import { requireMatch, type Rule } from "./rules.ts";

/** A generated app as Mayfly knows it. No field can loosen the contract. */
export interface Manifest {
  readonly name: string;
  readonly image: string;
}

const NAME: Rule = {
  subject: "app name",
  // A DNS label, short enough to take Mayfly's prefixes and suffixes.
  pattern: /^(?=.{1,40}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
  description: "lowercase letters, digits and inner hyphens, at most 40 characters",
};

/** A name a model proposed, which needs only an app name's shape: Mayfly then picks one that's free. */
export function parseProposedName(value: unknown): string {
  return requireMatch(value, NAME);
}

export function parseAppName(value: unknown): string {
  const name = parseProposedName(value);
  if (name === SIGN_IN) throw new ContractViolation(`app name must not be ${JSON.stringify(name)}, the name of Mayfly's sign-in`);
  return name;
}
