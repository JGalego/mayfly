import type { ConfigMap } from "./kube.ts";
import { authConfigName } from "./names.ts";
import { allowedRoles, type Policy } from "./policy.ts";

/** oauth2-proxy settings for one identity provider, keyed by environment variable. */
export type IdpSettings = Readonly<Record<`OAUTH2_PROXY_${string}`, string>>;

export interface AuthConfigInput {
  readonly appName: string;
  readonly policy: Policy;
  readonly idp: IdpSettings;
}

/** Everything a recipient changes to run a handed-over app: their identity provider and who gets in. */
export function buildAuthConfigMap({ appName, policy, idp }: AuthConfigInput): ConfigMap {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: authConfigName(appName) },
    data: { ...idp, OAUTH2_PROXY_ALLOWED_GROUPS: allowedRoles(policy) },
  };
}
