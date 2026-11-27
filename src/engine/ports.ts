import type { SignInSettings } from "../core/sign-out.ts";
import type { KubeObject } from "../core/kube.ts";
import type { App, State } from "./state.ts";
import type { Usage } from "./usage.ts";

export interface StateStore {
  load(): Promise<State>;
  save(state: State): Promise<void>;
}

/** Where the files people attach are kept, each under the hash of its contents, so a file attached twice is kept once. */
export interface FileStore {
  put(data: Uint8Array): Promise<string>;
  get(id: string): Promise<Uint8Array>;
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

/** A port on this computer that another program holds, so nothing of Mayfly's can listen on it. */
export class PortTaken extends Error {
  readonly port: number;

  constructor(port: number) {
    super(`Port ${port} on this computer is in use by another program. Stop that program, then try again.`);
    this.port = port;
  }
}

export interface IdentitySource {
  /** The pod that signs people in, to watch it like the apps. */
  readonly pod: string;
  /** The loopback port people sign in on, unless another program holds it. */
  readonly preferredPort: number;
  /** Brings the identity provider in line with the owner and apps in the state, signing people in on this port. Throws PortTaken when another program holds it. */
  sync(state: State, port: number): Promise<void>;
  /** Stops and removes the identity provider. */
  stop(): Promise<void>;
  /** How an app signs people in on this port, and out again. */
  settingsFor(app: App, port: number): SignInSettings;
}

/** A piece of what the person says to the model: text, or an image, in base64. */
export type Part = { readonly type: "text"; readonly text: string } | { readonly type: "image"; readonly mediaType: string; readonly data: string };

export interface Message {
  readonly role: "user" | "assistant";
  /** Text, or text and images when the person attached some. */
  readonly content: string | readonly Part[];
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

/** Whether the phone can reach this computer: its name on the private network, or what stands in the way. */
export type PhoneNetworkStatus =
  | { readonly state: "ready"; readonly host: string }
  | { readonly state: "missing" | "off" | "signed-out" | "no-https" }
  /** Another user on this computer holds the network, as Tailscale on Windows allows one at a time. */
  | { readonly state: "other-user"; readonly user: string }
  /** Mayfly couldn't tell how it is, and the reason is what the network said. */
  | { readonly state: "failed"; readonly reason: string };

/** The private network the phone reaches apps through. It serves HTTPS on the computer's name there. */
export interface PhoneNetwork {
  status(): Promise<PhoneNetworkStatus>;
  /** Serves HTTPS on this port of the computer's name, forwarding to a loopback port, across restarts until stopped. */
  serve(port: number, to: number): Promise<void>;
  /** Stops serving this port. A port that isn't served is already stopped. */
  stop(port: number): Promise<void>;
}

export interface Builder {
  /** Builds an app's image from its routes and returns the image's reference. */
  build(name: string, routes: string): Promise<string>;
  /** Runs the image briefly, cut off from the network, and visits it as a signed-in person would. */
  trial(image: string): Promise<Trial>;
  /** Removes every image built for an app. Any version can be built again from its code. */
  forget(name: string): Promise<void>;
}

export interface Ports {
  readonly store: StateStore;
  readonly deployer: Deployer;
  readonly observer: Observer;
  readonly identity: IdentitySource;
  /** The model with this id, or the default model for null or for an id that no longer exists. */
  readonly models: (id: string | null) => ModelProvider;
  readonly builder: Builder;
  readonly files: FileStore;
  readonly phoneNetwork: PhoneNetwork;
}
