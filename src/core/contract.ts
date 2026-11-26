// Fixed facts every generated app relies on.

/** Passed to the app as $PORT. */
export const APP_PORT = 8080;
/** The runtime image answers its own health check: Node calls the app's /healthz. */
export const HEALTH_CHECK = ["/usr/bin/node", "/app/runtime/health-check.ts"];
export const ROLES_CLAIM = "groups";
