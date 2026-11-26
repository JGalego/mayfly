import type { ConfigMap } from "./kube.ts";
import { authConfigName } from "./names.ts";
import type { Policy } from "./policy.ts";

/** The client Mayfly registered with the identity provider. */
export interface OidcClient {
  readonly issuerUrl: string;
  readonly clientId: string;
}

export interface AuthConfigInput {
  readonly appName: string;
  readonly policy: Policy;
  readonly idp: OidcClient;
}

export const AUTH_CONFIG_KEYS = {
  issuerUrl: "issuer-url",
  clientId: "client-id",
  allowedRoles: "allowed-roles",
} as const;

/** Everything a recipient changes to run a handed-over app: their identity provider and who gets in. */
export function buildAuthConfigMap({ appName, policy, idp }: AuthConfigInput): ConfigMap {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: authConfigName(appName) },
    data: {
      [AUTH_CONFIG_KEYS.issuerUrl]: idp.issuerUrl,
      [AUTH_CONFIG_KEYS.clientId]: idp.clientId,
      [AUTH_CONFIG_KEYS.allowedRoles]: policy.roles.join(","),
    },
  };
}
