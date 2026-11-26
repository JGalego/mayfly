import { APP_PORT, ROLES_CLAIM } from "./contract.ts";
import { HARDENED } from "./hardening.ts";
import type { Container, EnvVar } from "./kube.ts";
import { authSecretName, mayflyName } from "./names.ts";
import type { Policy } from "./policy.ts";

// Pinned: every app runs the proxy the contract was tested against.
const IMAGE = "quay.io/oauth2-proxy/oauth2-proxy:v7.15.6";
const PORT = 4180;
const LOOPBACK = "127.0.0.1";

/** The client Mayfly registered with the identity provider. */
export interface OidcClient {
  readonly issuerUrl: string;
  readonly clientId: string;
}

export interface AuthProxyInput {
  readonly appName: string;
  readonly policy: Policy;
  readonly idp: OidcClient;
  readonly hostPort: number;
}

/** Signs people in, admits only the policy's roles, and passes identity to the app in headers. */
export function buildAuthProxyContainer(input: AuthProxyInput): Container {
  return {
    name: "auth-proxy",
    image: IMAGE,
    args: [...signInArgs(input), ...authorizationArgs(input.policy), ...forwardingArgs()],
    env: secretEnv(input.appName),
    ports: [{ containerPort: PORT, hostPort: input.hostPort, hostIP: LOOPBACK }],
    livenessProbe: { httpGet: { path: "/ping", port: PORT } },
    securityContext: HARDENED,
    resources: { limits: { cpu: "100m", memory: "64Mi" } },
  };
}

function signInArgs({ appName, idp, hostPort }: AuthProxyInput): string[] {
  return [
    "--provider=oidc",
    `--oidc-issuer-url=${idp.issuerUrl}`,
    `--client-id=${idp.clientId}`,
    `--redirect-url=http://localhost:${hostPort}/oauth2/callback`,
    "--skip-provider-button=true",
    // Browsers share localhost cookies across ports, so each app needs its own.
    `--cookie-name=${mayflyName(appName)}`,
    // Plain HTTP on loopback, where a Secure cookie never comes back.
    "--cookie-secure=false",
  ];
}

function authorizationArgs(policy: Policy): string[] {
  return [
    // Access is decided by role, not by email domain.
    "--email-domain=*",
    `--oidc-groups-claim=${ROLES_CLAIM}`,
    ...policy.roles.map((role) => `--allowed-group=${role}`),
  ];
}

function forwardingArgs(): string[] {
  return [
    `--http-address=0.0.0.0:${PORT}`,
    `--upstream=http://${LOOPBACK}:${APP_PORT}/`,
    "--pass-user-headers=true",
  ];
}

// Secrets by reference only: their values never enter a spec.
function secretEnv(appName: string): EnvVar[] {
  return [
    fromAuthSecret("OAUTH2_PROXY_CLIENT_SECRET", "client-secret", appName),
    fromAuthSecret("OAUTH2_PROXY_COOKIE_SECRET", "cookie-secret", appName),
  ];
}

function fromAuthSecret(variable: string, key: string, appName: string): EnvVar {
  return { name: variable, valueFrom: { secretKeyRef: { name: authSecretName(appName), key } } };
}
