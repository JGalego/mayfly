import type { AppView } from "../../engine/engine.ts";
import type { Usage } from "../../engine/usage.ts";
import type { ModelChoice } from "./settings.ts";

/** A request in a conversation. An app of null starts a new app. */
export interface Work {
  readonly app: string | null;
  readonly request: string;
}

/** What the page asks the extension to do. */
export type FromUi =
  | { readonly type: "ready" }
  | ({ readonly type: "send" } & Work)
  | { readonly type: "open"; readonly name: string }
  | { readonly type: "remove"; readonly name: string }
  | { readonly type: "copy-password" }
  | { readonly type: "save-settings"; readonly choice: ModelChoice; readonly apiKey: string };

/** What the extension tells the page. Never a secret. */
export type ToUi =
  | {
      readonly type: "state";
      readonly apps: readonly AppView[];
      readonly owner: string;
      readonly model: ModelChoice;
      readonly hasApiKey: boolean;
      readonly spent: Usage;
      /** The request Mayfly is working on, if any. */
      readonly working: Work | null;
    }
  | { readonly type: "created"; readonly name: string }
  | { readonly type: "notice"; readonly text: string }
  | { readonly type: "error"; readonly text: string };
