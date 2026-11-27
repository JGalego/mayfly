import { serve } from "@hono/node-server";
import { buildApp } from "./app.ts";
import { importApp } from "./generated-app.ts";
import { log, useJsonConsole } from "./log.ts";
import type { SignOutTargets } from "./sign-out.ts";
import { DATA_FILE, openStore } from "./store.ts";

const SHUTDOWN_GRACE_MS = 5000;

useJsonConsole();
const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  log("error", "PORT must be a port number", { port: process.env.PORT });
  process.exit(1);
}

const { routes, kinds } = await importApp();
// Mayfly names them; a trial run has none, and no one to sign out.
const signOutTargets = JSON.parse(process.env.MAYFLY_SIGN_OUT ?? "{}") as SignOutTargets;
// Loopback only: the auth proxy in the same pod is the one way in.
const app = buildApp(routes, signOutTargets, openStore(DATA_FILE, kinds));
const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => log("info", "listening", { port }));

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    log("info", "shutting down", { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
  });
}
