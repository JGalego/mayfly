import { callbackUrl } from "../../core/app-url.ts";
import { mayflyName } from "../../core/names.ts";
import type { IdentitySource } from "../../engine/ports.ts";
import { OWNER_ROLE, type App, type State } from "../../engine/state.ts";
import { play } from "../podman/podman.ts";
import { buildDex, dexSettings, type DexClient, type DexUser } from "./dex.ts";

/** Dex on Podman, with the owner as its one user and one client per app. */
export const dexIdentity: IdentitySource = {
  async sync(state) {
    await play(await buildDex({ users: usersOf(state), clients: state.apps.map(clientOf) }));
  },

  settingsFor(app) {
    return dexSettings(clientId(app));
  },
};

function usersOf({ owner }: State): DexUser[] {
  return owner === null ? [] : [{ ...owner, groups: [OWNER_ROLE] }];
}

function clientOf(app: App): DexClient {
  return { id: clientId(app), secret: app.clientSecret, redirectUri: callbackUrl(app.hostPort) };
}

function clientId(app: App): string {
  return mayflyName(app.name);
}
