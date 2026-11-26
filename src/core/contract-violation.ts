/** Input that would break the contract every Mayfly app keeps. */
export class ContractViolation extends Error {
  override readonly name = "ContractViolation";
}
