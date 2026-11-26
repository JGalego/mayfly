import { randomBytes } from "node:crypto";

/** 32 hex characters, which is also the 32 bytes the proxy's cookie cipher needs. */
export function newSecret(): string {
  return randomBytes(16).toString("hex");
}

export function newPassword(): string {
  return randomBytes(18).toString("base64url");
}
