import { randomBytes, randomInt } from "node:crypto";
import { WORDS } from "./words.ts";

// About 77 bits from 7772 words: ample, when only someone on the tailnet or this computer can try one.
const PASSPHRASE_WORDS = 6;

/** 32 hex characters, which is also the 32 bytes the proxy's cookie cipher needs. */
export function newSecret(): string {
  return randomBytes(16).toString("hex");
}

/** A passphrase of random words, which people can read off one screen and type on another, a phone's included. */
export function newPassword(): string {
  return Array.from({ length: PASSPHRASE_WORDS }, () => WORDS[randomInt(WORDS.length)]).join("-");
}
