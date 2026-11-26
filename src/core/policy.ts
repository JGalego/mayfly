import { ContractViolation } from "./contract-violation.ts";
import { requireMatch, requireObject, type Rule } from "./rules.ts";

/** Who may use an app. Lives outside the app; the auth proxy enforces it. */
export interface Policy {
  readonly roles: readonly string[];
}

const ROLE: Rule = {
  subject: "role",
  // The proxy splits on commas, so roles must be plain tokens.
  pattern: /^[\w.:-]+$/,
  description: "letters, digits, '_', '.', ':' or '-'",
};

export function parsePolicy(value: unknown): Policy {
  const { roles } = requireObject(value, "policy");
  return { roles: requireRoleList(roles).map((role) => requireMatch(role, ROLE)) };
}

// Given no roles, the proxy lets every signed-in user in.
function requireRoleList(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ContractViolation("policy roles must be a non-empty list");
  }
  return value;
}
