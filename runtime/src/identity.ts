import type { MiddlewareHandler } from "hono";
import type { Env, User } from "./env.ts";

// Tailscale Serve, in front of the proxy for the phone, says who is on its network in headers of its own.
const PRIVATE_NETWORK_HEADER = /^tailscale-/;

/** Lets a request in only if the auth proxy signed someone in, and hands the routes who it is. */
export function requireIdentity(): MiddlewareHandler<Env> {
  return async (c, next) => {
    // Identity comes from the proxy alone, so no app comes to rely on anything else.
    for (const name of [...c.req.raw.headers.keys()]) if (PRIVATE_NETWORK_HEADER.test(name)) c.req.raw.headers.delete(name);
    const user = userFrom(c.req.raw.headers);
    if (user === undefined) return c.text("Unauthorized", 401);
    c.set("user", user);
    await next();
  };
}

function userFrom(headers: Headers): User | undefined {
  const id = headers.get("x-forwarded-user");
  if (!id) return undefined;
  const email = headers.get("x-forwarded-email") ?? "";
  return {
    id,
    email,
    name: headers.get("x-forwarded-preferred-username") || email,
    groups: (headers.get("x-forwarded-groups") ?? "").split(",").map((group) => group.trim()).filter(Boolean),
  };
}
