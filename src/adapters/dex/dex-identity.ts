import { callbackUrl } from "../../core/app-url.ts";
import { mayflyName } from "../../core/names.ts";
import { onPhone } from "../../core/phone.ts";
import type { IdentitySource } from "../../engine/ports.ts";
import { OWNER_ROLE, type App, type State } from "../../engine/state.ts";
import { down, play } from "../podman/podman.ts";
import { buildDex, DEX_POD, dexSettings, SIGN_IN_PORT, type DexClient, type DexUser } from "./dex.ts";

/** Dex on Podman, with the owner as its one user and one client per app, and the logo on its sign-in page. */
export function dexIdentity(logo?: string): IdentitySource {
  return {
    pod: DEX_POD,
    signInPort: SIGN_IN_PORT,

    async sync(state) {
      await play(await buildDex({ users: usersOf(state), clients: state.apps.map((app) => clientFor(app, state.phoneHost)), ...(logo === undefined ? {} : { logo }) }));
    },

    async stop() {
      await down(await buildDex({ users: [], clients: [] }));
    },

    settingsFor(app) {
      return dexSettings(clientId(app));
    },
  };
}

function usersOf({ owner }: State): DexUser[] {
  return owner === null ? [] : [{ ...owner, groups: [OWNER_ROLE] }];
}

/** An app's client: Dex sends people back to its localhost door, and while phone access is on, the phone to its phone door. */
export function clientFor(app: App, phoneHost: string | null): DexClient {
  const callback = callbackUrl(app.hostPort);
  const redirectUris = phoneHost === null ? [callback] : [callback, onPhone(callback, phoneHost)];
  return { id: clientId(app), secret: app.clientSecret, redirectUris };
}

function clientId(app: App): string {
  return mayflyName(app.name);
}
