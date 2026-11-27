import { PROXY_PREFIX } from "./contract.ts";

/** Where people open an app published on this host port. */
export function appUrl(hostPort: number): string {
  return `http://localhost:${hostPort}/`;
}

/** Where the identity provider sends people back to after they sign in. */
export function callbackUrl(hostPort: number): string {
  return new URL(`${PROXY_PREFIX}/callback`, appUrl(hostPort)).href;
}
