import type { IdpSettings } from "./auth-config-map.ts";
import { PROXY_PREFIX } from "./contract.ts";

/** How an app signs people in with an identity provider, and out of it. */
export interface SignInSettings {
  /** The auth proxy's settings, which go in the app's ConfigMap. */
  readonly proxy: IdpSettings;
  /** Where the computer's browser ends its session with the identity provider. */
  readonly endSessionUrl: string;
}

/** One way into an app: the address people open it at, and where that browser ends its session with the identity provider. */
export interface Door {
  readonly appUrl: string;
  readonly endSessionUrl: string;
}

// The auth proxy puts the app's ID token here, which tells the identity provider whose session to end without asking.
const ID_TOKEN = "{id_token}";

/**
 * Where the runtime sends people who sign out, by the address they opened the app at. The auth proxy ends the app's session,
 * then the identity provider ends its own, which would otherwise sign them straight back in, and sends them back to the app.
 */
export function signOutTargets(doors: readonly Door[]): Record<string, string> {
  return Object.fromEntries(doors.map((door) => [new URL(door.appUrl).host, signOutThrough(door)]));
}

function signOutThrough({ appUrl, endSessionUrl }: Door): string {
  const endSession = `${endSessionUrl}?id_token_hint=${ID_TOKEN}&post_logout_redirect_uri=${encodeURIComponent(appUrl)}`;
  return `${PROXY_PREFIX}/sign_out?rd=${encodeURIComponent(endSession)}`;
}
