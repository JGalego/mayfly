import { Hono } from "hono";
import { html } from "hono/html";
import type { Env } from "./runtime/env.ts";

// Written the way the model is asked to write apps: an HTML home page that greets whoever signed in and links to sign-out.
const app = new Hono<Env>();
app.get("/", (c) => c.html(html`<h1>Hello, ${c.get("user").email}</h1><a href="/oauth2/sign_out">Sign out</a>`));
export default app;
