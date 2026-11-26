import type { Secret } from "./kube.ts";
import { authConfigName } from "./names.ts";

export const AUTH_SECRET_KEYS = { clientSecret: "client-secret", cookieSecret: "cookie-secret" } as const;

export interface AuthSecretInput {
  readonly appName: string;
  readonly clientSecret: string;
  readonly cookieSecret: string;
}

/** Created on each machine that runs the app. Never part of what is handed over. */
export function buildAuthSecret({ appName, clientSecret, cookieSecret }: AuthSecretInput): Secret {
  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: authConfigName(appName) },
    stringData: { [AUTH_SECRET_KEYS.clientSecret]: clientSecret, [AUTH_SECRET_KEYS.cookieSecret]: cookieSecret },
  };
}
