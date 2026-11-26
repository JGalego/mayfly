import { SIGN_OUT_PATH } from "../core/contract.ts";

export const SYSTEM_PROMPT = [
  "Write the app's pages and logic in one TypeScript file, routes.ts. Mayfly provides sign-in, health checks, logging and security headers.",
  "",
  "The file:",
  '- Imports Hono with `import { Hono } from "hono";` and the runtime\'s types with `import type { Env } from "./runtime/env.ts";`.',
  "- Creates `const app = new Hono<Env>();`, adds the routes, and ends with `export default app;`.",
  '- Serves the app\'s main page as HTML at GET "/".',
  '- Imports only from "hono", its subpaths such as "hono/html", and Node\'s built-in modules ("node:..."). Nothing else is installed.',
  "- Is TypeScript that Node runs by stripping the types: no enums, namespaces, parameter properties, decorators or JSX.",
  "",
  "People:",
  '- Everyone who reaches the app is already signed in. `c.get("user")` gives `{ id, email, name, groups }`. Never add login, logout, passwords or sessions.',
  `- The home page must link to sign-out: \`<a href="${SIGN_OUT_PATH}">Sign out</a>\`.`,
  "- To show different things to different people, check `user.groups`.",
  "",
  "Pages:",
  '- Build HTML with the `html` tagged template from "hono/html", which escapes values. Never put user input into HTML any other way.',
  '- Pages may only load from their own origin. An inline script runs only if it carries the response\'s nonce: `<script nonce="${c.get("secureHeadersNonce")}">`. Inline styles are fine. No external scripts, styles, fonts or images.',
  "- Use short, specific labels and plain language. Omit taglines and filler.",
  "",
  "Data:",
  "- There is no database and the disk is read-only. Data kept in memory is lost when the app restarts. To keep something between visits, store it in the browser with localStorage.",
  "- Request bodies are limited to 1 MiB.",
  "- console.log and friends already write JSON lines. Log what would help someone fix a problem, and never secrets.",
  "",
  "Reply in exactly this format, and nothing else:",
  "",
  "name: <a short name for the app: lowercase letters, digits and hyphens, at most 40 characters>",
  "```ts",
  "<the whole of routes.ts>",
  "```",
  "<one or two short sentences: what the app does or what changed. No preamble or code.>",
  "",
  "For small changes, you can reply with edits instead:",
  "",
  "name: <the app's name>",
  "<<<<<<< SEARCH",
  "<lines copied exactly from the current routes.ts, indentation included>",
  "=======",
  "<the lines to put in their place>",
  ">>>>>>> REPLACE",
  "<more edits, if needed>",
  "<one or two short sentences: what changed. No preamble or code.>",
  "",
  "Each SEARCH must match exactly one place in the code. For a large change, reply with the whole of routes.ts.",
].join("\n");

export const ASK_PROMPT = [
  "You answer questions about a small web app that runs on Mayfly. You do not change it.",
  "The app is one TypeScript file, routes.ts, using Hono. Mayfly's runtime handles sign-in, health checks, logging and security headers around it.",
  "Answer directly in plain language. Quote code only when it helps.",
  "Never write a new version of the code. If a change is needed, say what to request.",
  "Answer in the language of the question.",
].join("\n");

/** A question about an app, with its code to answer from. */
export function questionFor(app: { readonly name: string; readonly routes: string }, question: string): string {
  const code = app.routes === "" ? "It has no code yet." : `Its code, routes.ts:\n\n\`\`\`ts\n${app.routes}\`\`\``;
  return `The app is called ${app.name}. ${code}\n\nThe question:\n\n${question}`;
}

/** Asks for the errors an app logged to be fixed. */
export function fixFor(errors: readonly string[]): string {
  return `Fix what makes the app log these errors:\n\n${errors.join("\n")}`;
}

export function requestFor(description: string): string {
  return `Write the app for this request:\n\n${description}`;
}

/** Asks for a change to an app that is already in use, so its stored data has to survive the change. */
export function changeFor(app: { readonly name: string; readonly routes: string }, change: string): string {
  // An app whose every attempt failed before it had any code starts over.
  if (app.routes === "") return requestFor(change);
  return [
    `This is routes.ts of the app ${app.name} now:`,
    "",
    "```ts",
    `${app.routes}\`\`\``,
    "",
    `Change the app for this request:\n\n${change}`,
    "",
    "Keep everything else as it is, including what the app keeps in localStorage and under which keys, so people keep their data.",
    `Reply with edits or with the whole new routes.ts, keeping the name ${app.name}.`,
  ].join("\n");
}

/** Asks for a fix. After edits, the model sees the code they made, rather than working it out. */
export function repairFor(problem: string, routes?: string): string {
  const now = routes === undefined ? "" : `\n\nWith your edits, routes.ts is now:\n\n\`\`\`ts\n${routes}\`\`\``;
  return `That did not work:\n\n${problem}${now}\n\nFix it and reply in the same format.`;
}
