import { AUTH_CONFIG_KEYS } from "./auth-config-map.ts";
import { APP_PORT, ROLES_CLAIM } from "./contract.ts";
import { HARDENED } from "./hardening.ts";
import type { Container, EnvVar } from "./kube.ts";
import { authConfigName, mayflyName } from "./names.ts";

// Pinned: every app runs the proxy the contract was tested against.
const IMAGE = "quay.io/oauth2-proxy/oauth2-proxy:v7.15.6";
const PORT = 4180;
const LOOPBACK = "127.0.0.1";

export interface AuthProxyInput {
  readonly appName: string;
  readonly hostPort: number;
}

/** Signs people in, admits only the policy's roles, and passes identity to the app in headers. */
export function buildAuthProxyContainer({ appName, hostPort }: AuthProxyInput): Container {
  return {
    name: "auth-proxy",
    image: IMAGE,
    args: [...signInArgs(appName, hostPort), ...authorizationArgs(), ...forwardingArgs()],
    env: [...configEnv(appName), ...secretEnv(appName)],
    ports: [{ containerPort: PORT, hostPort, hostIP: LOOPBACK }],
    livenessProbe: { httpGet: { path: "/ping", port: PORT } },
    securityContext: HARDENED,
    resources: { limits: { cpu: "100m", memory: "64Mi" } },
  };
}

function signInArgs(appName: string, hostPort: number): string[] {
  return [
    "--provider=oidc",
    `--redirect-url=http://localhost:${hostPort}/oauth2/callback`,
    "--skip-provider-button=true",
    // Browsers share localhost cookies across ports, so each app needs its own.
    `--cookie-name=${mayflyName(appName)}`,
    // Plain HTTP on loopback, where a Secure cookie never comes back.
    "--cookie-secure=false",
  ];
}

function authorizationArgs(): string[] {
  return [
    // Access is decided by role, not by email domain.
    "--email-domain=*",
    `--oidc-groups-claim=${ROLES_CLAIM}`,
  ];
}

function forwardingArgs(): string[] {
  return [
    `--http-address=0.0.0.0:${PORT}`,
    `--upstream=http://${LOOPBACK}:${APP_PORT}/`,
    "--pass-user-headers=true",
  ];
}

// Kept out of the pod so a recipient changes one ConfigMap, not the pod.
function configEnv(appName: string): EnvVar[] {
  return [
    fromConfigMap("OAUTH2_PROXY_OIDC_ISSUER_URL", AUTH_CONFIG_KEYS.issuerUrl, appName),
    fromConfigMap("OAUTH2_PROXY_CLIENT_ID", AUTH_CONFIG_KEYS.clientId, appName),
    fromConfigMap("OAUTH2_PROXY_ALLOWED_GROUPS", AUTH_CONFIG_KEYS.allowedRoles, appName),
  ];
}

// Secrets by reference only: their values never enter a spec.
function secretEnv(appName: string): EnvVar[] {
  return [
    fromSecret("OAUTH2_PROXY_CLIENT_SECRET", "client-secret", appName),
    fromSecret("OAUTH2_PROXY_COOKIE_SECRET", "cookie-secret", appName),
  ];
}

function fromConfigMap(variable: string, key: string, appName: string): EnvVar {
  return { name: variable, valueFrom: { configMapKeyRef: { name: authConfigName(appName), key } } };
}

function fromSecret(variable: string, key: string, appName: string): EnvVar {
  return { name: variable, valueFrom: { secretKeyRef: { name: authConfigName(appName), key } } };
}
