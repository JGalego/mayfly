import { APP_PORT, ROLES_CLAIM } from "./contract.ts";
import { LOOPBACK } from "./hardening.ts";

export interface DoorConfigInput {
  /** The port the door listens on, in the pod. */
  readonly listen: number;
  /** Where the door's browser signs in. By default, the page the app's ConfigMap names. */
  readonly loginUrl?: string;
}

/**
 * A door's settings, in oauth2-proxy's alpha config: the only form that can keep a request header from the app.
 * The identity provider and allowed roles still come from the app's ConfigMap, which the proxy reads into its
 * environment and fills in below. A string is quoted, but a flag or a list can't be, so a role must be a plain token.
 */
export function proxyConfig({ listen, loginUrl = fromEnvironment("OAUTH2_PROXY_LOGIN_URL") }: DoorConfigInput): string {
  return `server:
  bindAddress: 0.0.0.0:${listen}
upstreamConfig:
  upstreams:
    - id: app
      path: /
      uri: http://${LOOPBACK}:${APP_PORT}/
injectRequestHeaders:
  # Named with nothing to put in it, so the proxy only takes it out. Browsers send an app every cookie for its host,
  # whatever the port, which would hand it the other apps' sessions and the identity provider's.
  - name: Cookie
  - name: X-Forwarded-User
    values: [{ claimSource: { claim: user } }]
  - name: X-Forwarded-Email
    values: [{ claimSource: { claim: email } }]
  - name: X-Forwarded-Groups
    values: [{ claimSource: { claim: groups } }]
  - name: X-Forwarded-Preferred-Username
    values: [{ claimSource: { claim: preferred_username } }]
providers:
  - id: oidc
    provider: oidc
    clientID: '${fromEnvironment("OAUTH2_PROXY_CLIENT_ID")}'
    clientSecret: '${fromEnvironment("OAUTH2_PROXY_CLIENT_SECRET")}'
    scope: '${fromEnvironment("OAUTH2_PROXY_SCOPE")}'
    loginURL: '${loginUrl}'
    loginURLParameters: [{ name: approval_prompt, default: [auto] }]
    redeemURL: '${fromEnvironment("OAUTH2_PROXY_REDEEM_URL")}'
    allowedGroups: [${fromEnvironment("OAUTH2_PROXY_ALLOWED_GROUPS")}]
    oidcConfig:
      issuerURL: '${fromEnvironment("OAUTH2_PROXY_OIDC_ISSUER_URL")}'
      skipDiscovery: ${fromEnvironment("OAUTH2_PROXY_SKIP_OIDC_DISCOVERY")}
      jwksURL: '${fromEnvironment("OAUTH2_PROXY_OIDC_JWKS_URL")}'
      groupsClaim: ${ROLES_CLAIM}
`;
}

/** A variable the proxy fills in as it reads the file: from the app's ConfigMap, or for the client secret, its Secret. */
function fromEnvironment(variable: `OAUTH2_PROXY_${string}`): string {
  return `\${${variable}}`;
}
