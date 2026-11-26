import { appUrl } from "../core/app-url.ts";
import type { Manifest } from "../core/manifest.ts";
import { appObjects } from "./app-objects.ts";
import { generateApp } from "./generate.ts";
import type { Ports } from "./ports.ts";
import { newPassword, newSecret } from "./secrets.ts";
import { findApp, withApp, withoutApp, type App, type Owner, type State } from "./state.ts";

const FIRST_PORT = 18100;

export interface DeployedApp {
  readonly name: string;
  readonly url: string;
}

export interface Engine {
  /** Has the model write an app for the description, proves it runs, and deploys it. */
  create(description: string): Promise<DeployedApp>;
  /** Runs an app behind sign-in, or replaces its running version while keeping its URL and secrets. */
  deploy(manifest: Manifest): Promise<DeployedApp>;
  list(): Promise<DeployedApp[]>;
  remove(name: string): Promise<void>;
  /** Who signs in to the apps. Created on first use. */
  owner(): Promise<Owner>;
}

export function createEngine({ store, deployer, identity, model, builder }: Ports): Engine {
  async function deploy(manifest: Manifest): Promise<DeployedApp> {
    const state = withOwner(await store.load());
    const app = placeApp(state, manifest);
    const next = withApp(state, app);
    await identity.sync(next);
    await deployer.deploy(appObjects(app, identity.settingsFor(app)));
    await store.save(next);
    return deployedApp(app);
  }

  return {
    async create(description) {
      return deploy(await generateApp(description, { model, builder }));
    },

    deploy,

    async list() {
      return (await store.load()).apps.map(deployedApp);
    },

    async remove(name) {
      const state = await store.load();
      const app = findApp(state, name);
      if (app === undefined) throw new Error(`no app named ${name}`);
      await deployer.remove(appObjects(app, identity.settingsFor(app)));
      const next = withoutApp(state, name);
      await identity.sync(next);
      await store.save(next);
    },

    async owner() {
      const state = await store.load();
      if (state.owner !== null) return state.owner;
      const next = withOwner(state);
      await store.save(next);
      return next.owner;
    },
  };
}

function withOwner(state: State): State & { readonly owner: Owner } {
  const owner = state.owner ?? { email: "owner@mayfly.local", username: "owner", password: newPassword() };
  return { ...state, owner };
}

/** A redeployed app keeps its port and secrets, so its URL and sessions survive. */
function placeApp(state: State, manifest: Manifest): App {
  const existing = findApp(state, manifest.name);
  if (existing !== undefined) return { ...existing, manifest };
  return { manifest, hostPort: freePort(state), clientSecret: newSecret(), cookieSecret: newSecret() };
}

function freePort(state: State): number {
  const taken = new Set(state.apps.map((app) => app.hostPort));
  let port = FIRST_PORT;
  while (taken.has(port)) port++;
  return port;
}

function deployedApp(app: App): DeployedApp {
  return { name: app.manifest.name, url: appUrl(app.hostPort) };
}
