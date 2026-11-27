import type { Hono } from "hono";
import type { Env } from "./env.ts";
import { kindsFrom, type Kind } from "./records.ts";

// The generated app's one file sits next to the runtime: /app/routes.ts.
const ROUTES = new URL("../routes.ts", import.meta.url).href;

/** The generated app's routes, and the kinds of record it declares. Throws when it declares them wrong, which the trial shows the model. */
export async function importApp(): Promise<{ routes: Hono<Env>; kinds: Kind[] }> {
  const { default: routes, records = {} } = (await import(ROUTES)) as { default: Hono<Env>; records?: unknown };
  return { routes, kinds: kindsFrom(records) };
}
