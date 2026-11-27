import type { ToUi } from "./messages.ts";

/** Somewhere Mayfly shows: its tab in Podman Desktop, or a paired phone. */
export type Page = (message: ToUi) => unknown;

export interface Pages {
  /** Tells every open page. */
  post(message: ToUi): Promise<void>;
  /** Starts telling a page, until the function it returns closes it. */
  open(page: Page): () => void;
}

/** The pages open now, which all hear the one controller, so each shows the same work as it happens. */
export function openPages(): Pages {
  const open = new Set<Page>();
  return {
    post: async (message) => void (await Promise.all([...open].map((page) => page(message)))),
    open(page) {
      open.add(page);
      return () => void open.delete(page);
    },
  };
}
