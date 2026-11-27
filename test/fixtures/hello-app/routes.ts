import { Hono } from "hono";
import { html } from "hono/html";
import type { Env } from "./runtime/env.ts";

// Written the way the model is asked to write apps: an HTML home page that greets whoever signed in and links to sign-out.
const signOut = html`<a href="/oauth2/sign_out" style="display:inline-flex;align-items:center;gap:6px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9"/></svg>Sign out</a>`;
const app = new Hono<Env>();
app.get("/", (c) => c.html(html`<h1>Hello, ${c.get("user").email}</h1>${signOut}`));
export default app;
