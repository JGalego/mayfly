// Fixed facts every generated app relies on.

/** Passed to the app as $PORT. */
export const APP_PORT = 8080;
/** Where Node lives in the runtime image. */
export const NODE = "/usr/bin/node";

/** The runtime image answers its own health check: Node calls the app's /healthz. */
export const HEALTH_CHECK = [NODE, "/app/runtime/health-check.ts"];
export const ROLES_CLAIM = "groups";
/** Where the auth proxy signs people out. Every app's home page links to it. */
export const SIGN_OUT_PATH = "/oauth2/sign_out";
