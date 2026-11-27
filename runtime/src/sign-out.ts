import type { Handler } from "hono";
import type { Env } from "./env.ts";

/** Where to send people who sign out, by the address they opened the app at: each way in signs out on its own address. */
export type SignOutTargets = Readonly<Record<string, string>>;

/** Mayfly's contract: every app's home page links here. */
export const SIGN_OUT_PATH = "/oauth2/sign_out";

/** Sends people through the auth proxy's sign-out and the identity provider's, which Mayfly names in the targets. */
export function signOut(targets: SignOutTargets): Handler<Env> {
  return (c) => {
    // The server builds the URL from the Host header, which the auth proxy and the private network both keep.
    const target = targets[new URL(c.req.url).host];
    return target === undefined ? c.notFound() : c.redirect(target);
  };
}
