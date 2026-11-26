/** What Mayfly is doing while it makes or changes an app, for people who want to watch. */
export type Step =
  | { readonly kind: "writing"; readonly attempt: number }
  | { readonly kind: "wrote"; readonly routes: string }
  | { readonly kind: "trying" }
  | { readonly kind: "failed"; readonly problem: string }
  | { readonly kind: "deploying" };

export type Watcher = (step: Step) => void;

export const UNWATCHED: Watcher = () => {};
