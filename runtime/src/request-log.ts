import type { MiddlewareHandler } from "hono";
import type { Env, User } from "./env.ts";
import { log } from "./log.ts";

/** One line per request. The path only, never the query string, which may carry secrets. */
export function logRequests(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const start = performance.now();
    await next();
    const user = c.get("user") as User | undefined;
    log("info", "request", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - start),
      user: user?.email,
    });
  };
}
