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

export interface Message {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface ModelProvider {
  /** The model's reply to a conversation, under a system prompt. */
  complete(system: string, messages: readonly Message[]): Promise<string>;
}

export type Trial = { readonly ok: true } | { readonly ok: false; readonly problem: string };

export interface Builder {
  /** Builds an app's image from its routes and returns the image's reference. */
  build(name: string, routes: string): Promise<string>;
  /** Runs the image briefly, cut off from the network, and visits it as a signed-in person would. */
  trial(image: string): Promise<Trial>;
}

export interface Ports {
  readonly store: StateStore;
  readonly deployer: Deployer;
  readonly identity: IdentitySource;
  readonly model: ModelProvider;
  readonly builder: Builder;
}
