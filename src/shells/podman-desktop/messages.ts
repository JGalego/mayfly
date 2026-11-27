import type { AppView, ServiceHealth } from "../../engine/engine.ts";
import type { ModelCall } from "../../engine/state.ts";
import type { Step } from "../../engine/step.ts";
import type { Usage } from "../../engine/usage.ts";
import type { Examination } from "./doctor.ts";
import type { ModelSetting } from "./settings.ts";

/** A model as the page shows it: its settings, its name, and whether its key is saved. Never the key. */
export type ModelView = ModelSetting & { readonly label: string; readonly hasApiKey: boolean };

/** A request in a conversation. An app of null starts a new app. */
export interface Work {
  readonly app: string | null;
  readonly request: string;
  /** For a new app, the model to write it, or the default one. */
  readonly model?: string;
  /** Files the person attached. */
  readonly files?: readonly Upload[];
}

/** A file on its way from the page: its name, type, and contents in base64. */
export interface Upload {
  readonly name: string;
  readonly type: string;
  readonly data: string;
}

/** A request Mayfly is working on, and what it has done so far. */
export interface Progress extends Work {
  /** Making a new app, changing one, answering a question about it, deploying one of its versions, saving a hand edit to it, renaming it, starting it again, or removing it. */
  readonly kind: "create" | "change" | "ask" | "deploy" | "save" | "rename" | "start" | "remove";
  /** When Mayfly started on it, in milliseconds since the epoch. */
  readonly since: number;
  readonly steps: readonly Step[];
}

/** Something Mayfly did, kept for its activity log. */
export interface Activity {
  readonly at: number;
  readonly level: "info" | "error";
  readonly text: string;
}

/** What the page asks the extension to do. */
export type FromUi =
  | { readonly type: "ready" }
  | ({ readonly type: "send" } & Work)
  | { readonly type: "open"; readonly name: string }
  /** A link in a reply, which the extension opens only if it leads to a web page. */
  | { readonly type: "open-link"; readonly url: string }
  | { readonly type: "remove"; readonly name: string }
  | { readonly type: "copy"; readonly what: "email" | "password" }
  /** Shows a password in the page, for typing it on another device: the owner's, or that of the person named. */
  | { readonly type: "show-password"; readonly email?: string }
  | { readonly type: "save-model"; readonly model: ModelSetting; readonly apiKey: string }
  | { readonly type: "remove-model"; readonly id: string }
  | { readonly type: "default-model"; readonly id: string }
  | { readonly type: "use-model"; readonly app: string; readonly model: string }
  | { readonly type: "star"; readonly app: string; readonly starred: boolean }
  | { readonly type: "owner-email"; readonly email: string }
  /** A new password for the owner, or for the person named, whose email app gets a draft telling them. */
  | { readonly type: "new-password"; readonly email?: string }
  /** Adds someone to share apps with, and drafts the email that welcomes them. */
  | { readonly type: "add-person"; readonly email: string }
  | { readonly type: "remove-person"; readonly email: string }
  /** Drafts the welcome email again, with their password. */
  | { readonly type: "invite"; readonly email: string }
  /** Lets someone open an app, or no longer. Sharing drafts the email with its address. */
  | { readonly type: "share"; readonly app: string; readonly email: string; readonly shared: boolean }
  | { readonly type: "developer"; readonly on: boolean }
  | { readonly type: "health" }
  | { readonly type: "ledger" }
  | { readonly type: "doctor" }
  | { readonly type: "activity" }
  | { readonly type: "logs"; readonly pod: string; readonly container: string }
  | { readonly type: "code"; readonly app: string; readonly version: string }
  | { readonly type: "ask"; readonly app: string; readonly question: string; readonly files?: readonly Upload[] }
  /** A file from an app's conversation, for the page to show. */
  | { readonly type: "attachment"; readonly app: string; readonly id: string }
  | { readonly type: "fix" | "retry" | "undo" | "start"; readonly app: string }
  | { readonly type: "autostart"; readonly on: boolean }
  /** Lets the phone open the apps through Tailscale, or no longer. */
  | { readonly type: "phone"; readonly on: boolean }
  /** Whether the page has the focus, which it loses when Podman Desktop's window goes to the background. */
  | { readonly type: "focus"; readonly on: boolean }
  /** Sent by the extension, not the page, when Podman Desktop starts and the person wants stopped apps started. */
  | { readonly type: "start-stopped" }
  | { readonly type: "rename"; readonly app: string; readonly name: string }
  | { readonly type: "deploy"; readonly app: string; readonly version: string }
  | { readonly type: "save"; readonly app: string; readonly from: string; readonly routes: string; readonly message: string };

/** What the extension tells the page. Never a secret, but for a password the person asks to see. */
export type ToUi =
  | {
      readonly type: "state";
      readonly apps: readonly AppView[];
      readonly owner: string;
      /** Everyone the owner can share apps with, by email. */
      readonly people: readonly string[];
      readonly models: readonly ModelView[];
      /** The model new apps use. */
      readonly defaultModel: string;
      readonly spent: Usage;
      readonly working: Progress | null;
      /** Whether to show what developers want: code, versions, history, health and logs. */
      readonly developer: boolean;
      /** Whether to start the apps Podman is not running when Podman Desktop starts. */
      readonly autostart: boolean;
      /** The computer's name the phone opens apps on, or null while phone access is off. */
      readonly phoneHost: string | null;
    }
  | { readonly type: "progress"; readonly working: Progress }
  | { readonly type: "created"; readonly name: string }
  /** An app's new name, so the page follows it. */
  | { readonly type: "renamed"; readonly from: string; readonly to: string }
  /** A file from an app's conversation: its name, type, and contents in base64. */
  | { readonly type: "attachment"; readonly app: string; readonly id: string; readonly name: string; readonly mediaType: string; readonly data: string }
  /** The version a hand edit was saved as, so the editor carries on from it. */
  | { readonly type: "saved"; readonly app: string; readonly version: string }
  | { readonly type: "health"; readonly services: readonly ServiceHealth[] }
  | { readonly type: "ledger"; readonly calls: readonly ModelCall[] }
  | ({ readonly type: "doctor" } & Examination)
  | { readonly type: "activity"; readonly entries: readonly Activity[] }
  | { readonly type: "logs"; readonly pod: string; readonly container: string; readonly lines: readonly string[] }
  | { readonly type: "code"; readonly app: string; readonly version: string; readonly routes: string; readonly thinking: string }
  | { readonly type: "notice"; readonly text: string }
  /** A password the person asked to see: the owner's, or that of the person named. */
  | { readonly type: "password"; readonly password: string; readonly email?: string }
  /** Recorded when the app's conversation already says it, so the page need not. */
  | { readonly type: "error"; readonly text: string; readonly recorded?: true };
