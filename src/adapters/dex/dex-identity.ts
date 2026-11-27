import { createHmac } from "node:crypto";
import { appUrl, callbackUrl } from "../../core/app-url.ts";
import { mayflyName } from "../../core/names.ts";
import { onPhone } from "../../core/phone.ts";
import type { IdentitySource } from "../../engine/ports.ts";
import { OWNER_ROLE, type App, type Owner, type State } from "../../engine/state.ts";
import { down, play, removeVolume } from "../podman/podman.ts";
import { buildDex, DEX_POD, DEX_VOLUME, dexEndSession, dexSettings, PREFERRED_SIGN_IN_PORT, type DexClient, type DexUser } from "./dex.ts";

/** Dex on Podman, with the owner and the people they share apps with as its users, one client per app, and the logo on its sign-in page. */
export function dexIdentity(logo?: string): IdentitySource {
  return {
    pod: DEX_POD,
    preferredPort: PREFERRED_SIGN_IN_PORT,

    async sync(state, port) {
      const sessionKey = sessionKeyFor(state.owner);
      await play(await buildDex({ users: usersOf(state), clients: state.apps.map((app) => clientFor(app, state.phoneHost)), port, ...(logo === undefined ? {} : { logo }), ...(sessionKey === undefined ? {} : { sessionKey }) }));
    },

    // With no app to sign in to, its sessions and keys go too, and nothing is left behind.
    async stop() {
      await down(await buildDex({ users: [], clients: [] }));
      await removeVolume(DEX_VOLUME);
    },

    settingsFor(app, port) {
      return { proxy: dexSettings(clientId(app), port), endSessionUrl: dexEndSession(port) };
    },
  };
}

/**
 * What encrypts the cookie that keeps the owner signed in across apps. Drawn from their password, so it's the same each
 * time Dex starts, and a new password signs every device out.
 */
export function sessionKeyFor(owner: Owner | null): string | undefined {
  return owner === null ? undefined : createHmac("sha256", owner.password).update("mayfly sign-in sessions").digest("base64url").slice(0, 32);
}

// People sign in by email, which also names them to Dex: never the owner's name, which has no @.
function usersOf({ owner, people }: State): DexUser[] {
  const others = people.map(({ email, password, group }) => ({ email, username: email, password, groups: [group] }));
  return owner === null ? [] : [{ ...owner, groups: [OWNER_ROLE] }, ...others];
}

/** An app's client: Dex sends people back to its localhost door, and while phone access is on, the phone to its phone door. */
export function clientFor(app: App, phoneHost: string | null): DexClient {
  const doors = (url: string) => (phoneHost === null ? [url] : [url, onPhone(url, phoneHost)]);
  return { id: clientId(app), secret: app.clientSecret, redirectUris: doors(callbackUrl(app.hostPort)), postLogoutRedirectUris: doors(appUrl(app.hostPort)) };
}

function clientId(app: App): string {
  return mayflyName(app.name);
}
