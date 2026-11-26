import { serve } from "@hono/node-server";
import type { Hono } from "hono";
import { buildApp } from "./app.ts";
import type { Env } from "./env.ts";
import { log, useJsonConsole } from "./log.ts";

// The generated app's routes sit next to the runtime: /app/routes.ts.
const ROUTES = new URL("../routes.ts", import.meta.url).href;
const SHUTDOWN_GRACE_MS = 5000;

useJsonConsole();
const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  log("error", "PORT must be a port number", { port: process.env.PORT });
  process.exit(1);
}

const { default: routes } = (await import(ROUTES)) as { default: Hono<Env> };
// Loopback only: the auth proxy in the same pod is the one way in.
const server = serve({ fetch: buildApp(routes).fetch, port, hostname: "127.0.0.1" }, () => log("info", "listening", { port }));

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    log("info", "shutting down", { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
  });
}
