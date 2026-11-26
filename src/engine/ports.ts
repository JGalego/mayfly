import type { IdpSettings } from "../core/auth-config-map.ts";
import type { KubeObject } from "../core/kube.ts";
import type { App, State } from "./state.ts";
import type { Usage } from "./usage.ts";

export interface StateStore {
  load(): Promise<State>;
  save(state: State): Promise<void>;
}

export interface Deployer {
  /** Creates the objects, replacing any that already exist. */
  deploy(objects: readonly KubeObject[]): Promise<void>;
  remove(objects: readonly KubeObject[]): Promise<void>;
}

/** How one container is doing. */
export interface ContainerHealth {
  readonly name: string;
  /** Podman's word for it: running, exited, created and so on. */
  readonly state: string;
  /** Podman's own summary, such as "Up 5 minutes". */
  readonly status: string;
  readonly restarts: number;
  /** What its health check last found, for a container that has one. */
  readonly health?: "starting" | "healthy" | "unhealthy";
}

export interface PodHealth {
  readonly pod: string;
  readonly containers: readonly ContainerHealth[];
}

/** Watches the pods that run: how they are doing, and what they wrote. */
export interface Observer {
  /** The pods with these names that exist, and their containers. */
  health(pods: readonly string[]): Promise<PodHealth[]>;
  /** The last lines a pod's container wrote, oldest first, each starting with its time. */
  logs(pod: string, container: string, lines: number): Promise<string[]>;
}

export interface IdentitySource {
  /** The pod that signs people in, to watch it like the apps. */
  readonly pod: string;
  /** Brings the identity provider in line with the owner and apps in the state. */
  sync(state: State): Promise<void>;
  /** The proxy settings an app uses to sign people in. */
  settingsFor(app: App): IdpSettings;
}

export interface Message {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface Completion {
  readonly text: string;
  /** What the model thought before it replied, when its provider shares that, or empty. */
  readonly thinking: string;
  readonly usage: Usage;
}

/** Where a reply goes, piece by piece, as it arrives. */
export interface Listener {
  readonly text?: (piece: string) => void;
  readonly thinking?: (piece: string) => void;
}

export interface ModelProvider {
  /** The model as people know it, such as "OpenAI · gpt-6.2-sol". Every version it writes keeps it. */
  readonly name: string;
  /** Who provides it, such as "OpenAI" or "localhost:11434". */
  readonly provider: string;
  /** The model's reply to a conversation, under a system prompt, and what it cost. */
  complete(system: string, messages: readonly Message[], listener?: Listener): Promise<Completion>;
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
  readonly observer: Observer;
  readonly identity: IdentitySource;
  /** The model with this id, or the default model for null or for an id that no longer exists. */
  readonly models: (id: string | null) => ModelProvider;
  readonly builder: Builder;
}
