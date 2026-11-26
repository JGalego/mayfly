import type { DeployedApp } from "../../engine/engine.ts";

/** What the page asks the extension to do. */
export type FromUi =
  | { readonly type: "ready" }
  | { readonly type: "create"; readonly description: string }
  | { readonly type: "open"; readonly name: string }
  | { readonly type: "remove"; readonly name: string }
  | { readonly type: "copy-password" }
  | { readonly type: "save-api-key"; readonly apiKey: string };

/** What the extension tells the page. Never a secret. */
export type ToUi =
  | {
      readonly type: "state";
      readonly apps: readonly DeployedApp[];
      readonly owner: string;
      readonly hasApiKey: boolean;
      readonly model: string;
    }
  | { readonly type: "busy"; readonly text: string }
  | { readonly type: "notice"; readonly text: string }
  | { readonly type: "error"; readonly text: string };
