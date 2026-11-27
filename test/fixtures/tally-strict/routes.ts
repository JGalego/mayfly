import { Hono } from "hono";
import { html } from "hono/html";
import type { Env } from "./runtime/env.ts";

// A change to the tally that breaks the one rule: it adds a field every visit must have, which the visits kept so far lack.
export const records = { "visit:": { count: "number", first: "string" } };

const app = new Hono<Env>();
app.get("/", (c) => c.html(html`<p>Visits</p><a href="/oauth2/sign_out">Sign out</a>`));
export default app;
