import type { MiddlewareHandler } from "hono";
import type { Env } from "./env.ts";

// Reading changes nothing, so any page may link to the app.
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Refuses a request that may change something unless the app's own pages sent it. Browsers send an app's cookies, its
 * sign-in session among them, with requests from every app on the same host, whatever the port, so another app's page
 * could otherwise act as whoever has this one open.
 */
export function sameOriginOnly(): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (SAFE.has(c.req.method) || fromItsOwnPages(c.req.raw.headers)) return next();
    return c.text("Forbidden", 403);
  };
}

function fromItsOwnPages(headers: Headers): boolean {
  const site = headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin" || site === "none";
  // Browsers too old to say where a request comes from still say which page sent it.
  const origin = headers.get("origin");
  // Neither comes from no browser's page, and so carries no browser's cookies.
  if (origin === null) return true;
  return URL.canParse(origin) && new URL(origin).host === headers.get("host");
}
