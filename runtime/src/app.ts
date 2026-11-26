import { Hono, type ErrorHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { NONCE, secureHeaders } from "hono/secure-headers";
import type { Env } from "./env.ts";
import { requireIdentity } from "./identity.ts";
import { log } from "./log.ts";
import { logRequests } from "./request-log.ts";

const ONE_MEGABYTE = 1024 * 1024;

/** Wraps a generated app's routes in everything the contract promises and the model never writes. */
export function buildApp(routes: Hono<Env>): Hono<Env> {
  const app = new Hono<Env>();
  // Ahead of everything else: the liveness probe has no identity and its checks should not fill the logs.
  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.use(logRequests());
  app.use(secureHeaders({ contentSecurityPolicy: CONTENT_SECURITY_POLICY }));
  app.use(bodyLimit({ maxSize: ONE_MEGABYTE }));
  app.use(requireIdentity());
  app.route("/", routes);
  app.onError(hideError);
  return app;
}

// Pages load nothing from other origins, and only scripts carrying the response's nonce run.
const CONTENT_SECURITY_POLICY = {
  defaultSrc: ["'self'"],
  scriptSrc: [NONCE],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", "data:"],
  objectSrc: ["'none'"],
  baseUri: ["'none'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
};

// An HTTPException is a response someone chose, such as 413 from the body limit. Anything else is a bug.
const hideError: ErrorHandler<Env> = (error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  log("error", "unhandled error", { path: c.req.path, error: error.message, stack: error.stack });
  return c.text("Internal Server Error", 500);
};
