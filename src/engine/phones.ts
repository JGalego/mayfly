import { createHash, randomBytes } from "node:crypto";
import type { PairedPhone, State } from "./state.ts";

/** How long a pairing code works once the computer shows it. */
export const PAIRING_LIFETIME_MS = 5 * 60_000;
const NAME_LENGTH = 40;

/** A pairing code the computer showed: kept only as a hash, and good once, until it expires. */
export interface PairingOffer {
  readonly codeHash: string;
  readonly expires: number;
}

/** A new pairing code, for the computer to show, and the offer that accepts it. */
export function offerPairing(now: number): { readonly code: string; readonly offer: PairingOffer } {
  const code = randomBytes(16).toString("base64url");
  return { code, offer: { codeHash: hashOf(code), expires: now + PAIRING_LIFETIME_MS } };
}

/** Pairs the phone that brought the code: the token it keeps, and the state with the token's hash. */
export function withPhone(state: State, offer: PairingOffer | null, code: string, name: string, now: number): { readonly state: State; readonly token: string; readonly phone: PairedPhone } {
  if (offer === null || now > offer.expires || hashOf(code) !== offer.codeHash) throw new Error("This pairing code doesn't work. Show a new one on the computer.");
  const token = randomBytes(32).toString("base64url");
  const phone = { id: randomBytes(4).toString("hex"), name: name.trim().slice(0, NAME_LENGTH) || "Phone", pairedAt: now, tokenHash: hashOf(token) };
  return { state: { ...state, phones: [...state.phones, phone] }, token, phone };
}

/** The paired phone a token belongs to. */
export function phoneWith(state: State, token: string): PairedPhone | undefined {
  // Comparing hashes, so how long a comparison takes says nothing about any token.
  const hash = hashOf(token);
  return state.phones.find((phone) => phone.tokenHash === hash);
}

export function withoutPhone(state: State, id: string): State {
  return { ...state, phones: state.phones.filter((phone) => phone.id !== id) };
}

function hashOf(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
