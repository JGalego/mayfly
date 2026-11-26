import { SIGN_OUT_PATH } from "../core/contract.ts";
import { kindOf, textOf, type FileData } from "./attachments.ts";
import type { Part } from "./ports.ts";

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
  `- People sign out at ${SIGN_OUT_PATH}, which the runtime handles. The home page must link to it: put a small \`<a href="${SIGN_OUT_PATH}">Sign out</a>\` somewhere unobtrusive, such as a corner of the page. A home page without it is sent back.`,
  "- To show different things to different people, check `user.groups`.",
  "",
  "Pages:",
  '- Build HTML with the `html` tagged template from "hono/html", which escapes values. Never put user input into HTML any other way.',
  '- Pages may only load from their own origin. An inline script runs only if it carries the response\'s nonce: `<script nonce="${c.get("secureHeadersNonce")}">`. Inline styles are fine. No external scripts, styles, fonts or images.',
  "- Keep the page simple and clear for someone who is not technical.",
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
  "<one or two short sentences for the person: what the app does, or what you changed. Plain words, no code.>",
  "",
  "When you change an app that exists, you may reply with edits instead, which is quicker for small changes:",
  "",
  "name: <the app's name>",
  "<<<<<<< SEARCH",
  "<lines copied exactly from the current routes.ts, indentation included>",
  "=======",
  "<the lines to put in their place>",
  ">>>>>>> REPLACE",
  "<more edits, if needed>",
  "<one or two short sentences for the person: what you changed.>",
  "",
  "Each SEARCH must match exactly one place in the code. Give just enough lines for that. For a large change, reply with the whole of routes.ts.",
].join("\n");

// What the model is told when the person asks about an app rather than for a change to it.
export const ASK_PROMPT = [
  "You answer questions about a small web app that runs on Mayfly. You do not change it.",
  "The app is one TypeScript file, routes.ts, using Hono. Mayfly's runtime handles sign-in, health checks, logging and security headers around it.",
  "Answer in plain words and briefly, for someone who may not read code. Quote a line or two of the code only when it helps.",
  "Never write a new version of the code. If the answer is that the app should change, say what to ask for: the person can ask for the change in the conversation.",
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

/**
 * A request with the files the person attached: text files after it, each named and fenced, and images as images, which a line names.
 * Without images, it stays text, which every model takes.
 */
export function withFiles(request: string, files: readonly FileData[]): string | Part[] {
  const texts = files.filter((file) => kindOf(file) === "text").map((file) => attached(file.name, textOf(file) ?? ""));
  const images = files.filter((file) => kindOf(file) === "image");
  const named = images.length === 0 ? [] : [`The person attached ${images.length === 1 ? "an image" : `${images.length} images`}: ${images.map((file) => file.name).join(", ")}.`];
  const text = [request, ...texts, ...named].join("\n\n");
  if (images.length === 0) return text;
  return [{ type: "text", text }, ...images.map((file): Part => ({ type: "image", mediaType: file.type, data: Buffer.from(file.data).toString("base64") }))];
}

// Fenced with more backticks than any run inside, so the file cannot end its own fence.
function attached(name: string, contents: string): string {
  const longest = Math.max(2, ...[...contents.matchAll(/`+/g)].map((run) => run[0].length));
  const fence = "`".repeat(longest + 1);
  return `The person attached ${name}:\n\n${fence}\n${contents}\n${fence}`;
}
