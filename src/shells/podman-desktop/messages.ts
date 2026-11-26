import type { AppView, ServiceHealth } from "../../engine/engine.ts";
import type { Step } from "../../engine/step.ts";
import type { Usage } from "../../engine/usage.ts";
import type { Check } from "./doctor.ts";
import type { ModelSetting } from "./settings.ts";

/** A model as the page shows it: its settings, its name, and whether its key is saved. Never the key. */
export type ModelView = ModelSetting & { readonly label: string; readonly hasApiKey: boolean };

/** A request in a conversation. An app of null starts a new app. */
export interface Work {
  readonly app: string | null;
  readonly request: string;
  /** For a new app, the model to write it, or the default one. */
  readonly model?: string;
}

/** A request Mayfly is working on, and what it has done so far. */
export interface Progress extends Work {
  /** Making a new app, changing one, going back to an earlier version, editing it by hand, or removing it. */
  readonly kind: "create" | "change" | "restore" | "edit" | "remove";
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
  | { readonly type: "remove"; readonly name: string }
  | { readonly type: "copy"; readonly what: "email" | "password" }
  | { readonly type: "save-model"; readonly model: ModelSetting; readonly apiKey: string }
  | { readonly type: "remove-model"; readonly id: string }
  | { readonly type: "default-model"; readonly id: string }
  | { readonly type: "use-model"; readonly app: string; readonly model: string }
  | { readonly type: "star"; readonly app: string; readonly starred: boolean }
  | { readonly type: "owner-email"; readonly email: string }
  | { readonly type: "new-password" }
  | { readonly type: "developer"; readonly on: boolean }
  | { readonly type: "health" }
  | { readonly type: "doctor" }
  | { readonly type: "activity" }
  | { readonly type: "logs"; readonly pod: string; readonly container: string }
  | { readonly type: "code"; readonly app: string; readonly version: string }
  | { readonly type: "restore"; readonly app: string; readonly version: string }
  | { readonly type: "edit"; readonly app: string; readonly routes: string; readonly message: string };

/** What the extension tells the page. Never a secret. */
export type ToUi =
  | {
      readonly type: "state";
      readonly apps: readonly AppView[];
      readonly owner: string;
      readonly models: readonly ModelView[];
      /** The model new apps use. */
      readonly defaultModel: string;
      readonly spent: Usage;
      readonly working: Progress | null;
      /** Whether to show what developers want: code, versions, history, health and logs. */
      readonly developer: boolean;
    }
  | { readonly type: "progress"; readonly working: Progress }
  | { readonly type: "created"; readonly name: string }
  | { readonly type: "health"; readonly services: readonly ServiceHealth[] }
  | { readonly type: "doctor"; readonly checks: readonly Check[] }
  | { readonly type: "activity"; readonly entries: readonly Activity[] }
  | { readonly type: "logs"; readonly pod: string; readonly container: string; readonly lines: readonly string[] }
  | { readonly type: "code"; readonly app: string; readonly version: string; readonly routes: string }
  | { readonly type: "notice"; readonly text: string }
  | { readonly type: "error"; readonly text: string };
