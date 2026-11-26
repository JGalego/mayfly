import { ContractViolation } from "./contract-violation.ts";

/** What an input value must look like, as a pattern and in words. */
export interface Rule {
  readonly subject: string;
  readonly pattern: RegExp;
  readonly description: string;
}

export function requireObject(value: unknown, subject: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContractViolation(`${subject} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function requireMatch(value: unknown, rule: Rule): string {
  if (typeof value !== "string" || !rule.pattern.test(value)) {
    throw new ContractViolation(`${rule.subject} must be ${rule.description}, got ${JSON.stringify(value)}`);
  }
  return value;
}
