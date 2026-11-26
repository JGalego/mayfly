import type { IdpSettings } from "../core/auth-config-map.ts";
import type { KubeObject } from "../core/kube.ts";
import type { App, State } from "./state.ts";

export interface StateStore {
  load(): Promise<State>;
  save(state: State): Promise<void>;
}

export interface Deployer {
  /** Creates the objects, replacing any that already exist. */
  deploy(objects: readonly KubeObject[]): Promise<void>;
  remove(objects: readonly KubeObject[]): Promise<void>;
}

export interface IdentitySource {
  /** Brings the identity provider in line with the owner and apps in the state. */
  sync(state: State): Promise<void>;
  /** The proxy settings an app uses to sign people in. */
  settingsFor(app: App): IdpSettings;
}

export interface Ports {
  readonly store: StateStore;
  readonly deployer: Deployer;
  readonly identity: IdentitySource;
}
