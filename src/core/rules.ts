import { ContractViolation } from "./contract-violation.ts";

/** What an input value must look like, as a pattern and in words. */
export interface Rule {
  readonly subject: string;
  readonly pattern: RegExp;
  readonly description: string;
}

export function requireMatch(value: unknown, rule: Rule): string {
  if (typeof value !== "string" || !rule.pattern.test(value)) {
    throw new ContractViolation(`${rule.subject} must be ${rule.description}, got ${JSON.stringify(value)}`);
  }
  return value;
}
