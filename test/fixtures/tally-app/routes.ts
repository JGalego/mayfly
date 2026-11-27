import { Hono } from "hono";
import { html } from "hono/html";
import type { Env } from "./runtime/env.ts";

// An app that keeps data the way the model is asked to: it counts each person's visits in its store.
export const records = { "visit:": { count: "number" } };

const app = new Hono<Env>();
app.get("/", (c) => {
  const store = c.get("store");
  const key = `visit:${c.get("user").email}`;
  const count = Number(store.get(key)?.count ?? 0) + 1;
  store.set(key, { count });
  return c.html(html`<p>Visits: ${count}</p><a href="/oauth2/sign_out">Sign out</a>`);
});
export default app;
