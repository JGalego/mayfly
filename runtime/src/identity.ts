import type { MiddlewareHandler } from "hono";
import type { Env, User } from "./env.ts";

/** Lets a request in only if the auth proxy signed someone in, and hands the routes who it is. */
export function requireIdentity(): MiddlewareHandler<Env> {
  return async (c, next) => {
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
