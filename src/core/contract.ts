// Fixed facts every generated app relies on.

/** Passed to the app as $PORT. */
export const APP_PORT = 8080;
/** Where Node lives in the runtime image. */
export const NODE = "/usr/bin/node";

/** The runtime image answers its own health check: Node calls the app's /healthz. */
export const HEALTH_CHECK = [NODE, "/app/runtime/health-check.ts"];
export const ROLES_CLAIM = "groups";
/** Where people sign out. Every app's home page links to it, and the runtime answers it, so it ends every session that would sign them back in. */
export const SIGN_OUT_PATH = "/oauth2/sign_out";
/** The auth proxy's own pages, apart from the app's. */
export const PROXY_PREFIX = "/.mayfly";
/** Tells the runtime where the sign-out link goes, as JSON, by the address the app was opened at. */
export const SIGN_OUT_ENV = "MAYFLY_SIGN_OUT";
