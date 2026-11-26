import type { AppView } from "../../engine/engine.ts";
import type { Step } from "../../engine/step.ts";
import type { Usage } from "../../engine/usage.ts";
import type { ModelChoice } from "./settings.ts";

/** A request in a conversation. An app of null starts a new app. */
export interface Work {
  readonly app: string | null;
  readonly request: string;
}

/** A request Mayfly is working on, and what it has done so far. */
export interface Progress extends Work {
  /** When Mayfly started on it, in milliseconds since the epoch. */
  readonly since: number;
  readonly steps: readonly Step[];
}

/** What the page asks the extension to do. */
export type FromUi =
  | { readonly type: "ready" }
  | ({ readonly type: "send" } & Work)
  | { readonly type: "open"; readonly name: string }
  | { readonly type: "remove"; readonly name: string }
  | { readonly type: "copy-password" }
  | { readonly type: "save-settings"; readonly choice: ModelChoice; readonly apiKey: string }
  | { readonly type: "peek"; readonly on: boolean }
  | { readonly type: "code"; readonly app: string; readonly version: string };

/** What the extension tells the page. Never a secret. */
export type ToUi =
  | {
      readonly type: "state";
      readonly apps: readonly AppView[];
      readonly owner: string;
      readonly model: ModelChoice;
      readonly hasApiKey: boolean;
      readonly spent: Usage;
      readonly working: Progress | null;
      /** Whether to show the code and each step of making an app. */
      readonly peek: boolean;
    }
  | { readonly type: "progress"; readonly working: Progress }
  | { readonly type: "created"; readonly name: string }
  | { readonly type: "code"; readonly app: string; readonly version: string; readonly routes: string }
  | { readonly type: "notice"; readonly text: string }
  | { readonly type: "error"; readonly text: string };
