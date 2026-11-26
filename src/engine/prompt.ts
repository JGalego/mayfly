// What the model is told. The runtime enforces the important parts anyway: sign-in, the CSP,
// JSON logs, the body limit. The prompt is there so the model's code works with them, not against them.

export const SYSTEM_PROMPT = [
  "You write small web apps that run on Mayfly. Each app is one TypeScript file, routes.ts, that runs inside a fixed runtime. The runtime already handles sign-in, health checks, logging and security headers, so you write only the app's own pages and logic.",
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
  "- To show different things to different people, check `user.groups`.",
  "",
  "Pages:",
  '- Build HTML with the `html` tagged template from "hono/html", which escapes values. Never put user input into HTML any other way.',
  '- Pages may only load from their own origin. An inline script runs only if it carries the response\'s nonce: `<script nonce="${c.get("secureHeadersNonce")}">`. Inline styles are fine. No external scripts, styles, fonts or images.',
  "- Keep the page simple and clear for someone who is not technical.",
  "",
  "Data:",
  "- There is no database and the disk is read-only. Data kept in memory is lost when the app restarts. To keep something between visits, store it in the browser with localStorage.",
  "- Request bodies are limited to 1 MB.",
  "- console.log and friends already write JSON lines. Log what would help someone fix a problem, and never secrets.",
  "",
  "Reply in exactly this format, and nothing else:",
  "",
  "name: <a short name for the app: lowercase letters, digits and hyphens, at most 40 characters>",
  "```ts",
  "<the whole of routes.ts>",
  "```",
  "<one or two short sentences for the person: what the app does, or what you changed. Plain words, no code.>",
].join("\n");

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
    `Reply with the whole new routes.ts, in the same format, keeping the name ${app.name}.`,
  ].join("\n");
}

export function repairFor(problem: string): string {
  return `That app did not pass its trial run:\n\n${problem}\n\nFix it and reply with the whole of routes.ts, in the same format.`;
}
