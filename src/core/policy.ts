import { ContractViolation } from "./contract-violation.ts";
import { requireMatch, type Rule } from "./rules.ts";

/** Who may use an app. Lives outside the app; the auth proxy enforces it. */
export interface Policy {
  readonly roles: readonly string[];
}

const ROLE: Rule = {
  subject: "role",
  // The proxy splits roles on commas, and its settings list them in YAML, so each must be a plain token.
  pattern: /^[\w.:-]+$/,
  description: "letters, digits, '_', '.', ':' or '-'",
};

/** The roles the proxy lets in, as it takes them. Never none, which the proxy would read as everyone. */
export function allowedRoles({ roles }: Policy): string {
  if (roles.length === 0) throw new ContractViolation("policy roles must be a non-empty list");
  return roles.map((role) => requireMatch(role, ROLE)).join(",");
}
