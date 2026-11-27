// Fixed facts every generated app relies on.

/** Passed to the app as $PORT. */
export const APP_PORT = 8080;
/** Where Node lives in the runtime image. */
export const NODE = "/usr/bin/node";

/** The runtime image answers its own health check: Node calls the app's /healthz. */
export const HEALTH_CHECK = [NODE, "/app/runtime/health-check.ts"];
export const ROLES_CLAIM = "groups";
/** How long the home page may take to answer, all of it, when the trial visits. */
export const HOME_PAGE_TIMEOUT_MS = 10_000;
/** Where people sign out. Every app's home page links to it, and the runtime answers it, so it ends every session that would sign them back in. */
export const SIGN_OUT_PATH = "/oauth2/sign_out";
/** The auth proxy's own pages, apart from the app's. */
export const PROXY_PREFIX = "/.mayfly";
/** Tells the runtime where the sign-out link goes, as JSON, by the address the app was opened at. */
export const SIGN_OUT_ENV = "MAYFLY_SIGN_OUT";
/** Where an app keeps its records: the one folder it can write to, on a volume of its own. */
export const DATA_DIR = "/data";
/** The runtime's check that an app's stored records fit the kinds its code declares. It prints a report. */
export const DATA_CHECK = [NODE, "/app/runtime/data-check.ts"];
/** The runtime's copy of an app's records from one folder to another. It runs none of the app's code. */
export const DATA_COPY = [NODE, "/app/runtime/data-copy.ts"];
/** The runtime's export of the records in a folder, as JSON by key on stdout. It runs none of the app's code. */
export const DATA_EXPORT = [NODE, "/app/runtime/data-export.ts"];
