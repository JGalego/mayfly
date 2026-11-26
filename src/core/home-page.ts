import { SIGN_OUT_PATH } from "./contract.ts";

/** What an app's home page answered, as the trial run saw it. */
export interface HomePage {
  readonly status: number;
  readonly type: string;
  readonly body: string;
}

// A link or a form that goes to the sign-out address, however its attribute is quoted. A mention in the text is not a way out.
const SIGN_OUT_LINK = new RegExp(`\\b(?:href|action)\\s*=\\s*["']?${SIGN_OUT_PATH}`, "i");

/** Why the home page breaks the contract, in words for the model to fix it, or null when it keeps it. */
export function homePageProblem({ status, type, body }: HomePage): string | null {
  if (status !== 200 || !type.startsWith("text/html")) return `GET / answered ${status} ${type || "with no content type"}, not an HTML page.`;
  if (!SIGN_OUT_LINK.test(body)) return `The home page has no link to ${SIGN_OUT_PATH}, so people cannot sign out. Add a small "Sign out" link to it.`;
  return null;
}
