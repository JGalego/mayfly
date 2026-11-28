import { randomBytes, randomInt } from "node:crypto";
import { WORDS } from "./words.ts";

// About 77 bits from 7772 words: ample, when only someone on the tailnet or this computer can try one.
const PASSPHRASE_WORDS = 6;

/** 32 hex characters, which is also the 32 bytes the proxy's cookie cipher needs. */
export function newSecret(): string {
  return randomBytes(16).toString("hex");
}

// Dex keeps a bcrypt hash of each password, and bcrypt reads no more than this.
const MOST_BYTES = 72;
const FEWEST_CHARACTERS = 12;

/** A password someone chose, once it's long enough to resist guessing and short enough for bcrypt to read all of it. */
export function chosenPassword(password: string): string {
  if ([...password].length < FEWEST_CHARACTERS) throw new Error(`Use at least ${FEWEST_CHARACTERS} characters`);
  if (Buffer.byteLength(password) > MOST_BYTES) throw new Error("Use a shorter password");
  return password;
}

/** A passphrase of random words, which people can read off one screen and type on another, a phone's included. */
export function newPassword(): string {
  return Array.from({ length: PASSPHRASE_WORDS }, () => WORDS[randomInt(WORDS.length)]).join("-");
}
