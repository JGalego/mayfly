import { callbackUrl } from "./app-url.ts";
import { AUTH_SECRET_KEYS } from "./auth-secret.ts";
import { APP_PORT, PROXY_PREFIX, ROLES_CLAIM } from "./contract.ts";
import { HARDENED, LOOPBACK } from "./hardening.ts";
import type { Container, EnvVar } from "./kube.ts";
import { authConfigName, mayflyName } from "./names.ts";
import { onPhone, phoneDoorPort, type PhoneSignIn } from "./phone.ts";

// Pinned: every app runs the proxy the contract was tested against.
const IMAGE = "quay.io/oauth2-proxy/oauth2-proxy:v7.15.6";
const PORT = 4180;
// The phone door shares the pod's network with the localhost door, so it listens on the next port.
const PHONE_DOOR_PORT = 4181;

export interface AuthProxyInput {
  readonly appName: string;
  readonly hostPort: number;
  /** Where the computer's browser ends its session with the identity provider. */
  readonly endSessionUrl: string;
}

/** Where a door sends people back to after they sign in, and how it keeps their session. */
interface Origin {
  readonly redirectUrl: string;
  /** Overrides the ConfigMap's sign-in page, which is the computer's. */
  readonly loginUrl?: string;
  /** Where this door's browser ends its session with the identity provider, after the app's. */
  readonly endSessionUrl: string;
  readonly secureCookie: boolean;
}

/**
 * Signs people in, admits only the policy's roles, and passes identity to the app in headers.
 * No liveness probe: the image is one binary with nothing to run a probe with. A crash still restarts it.
 */
export function buildAuthProxyContainer({ appName, hostPort, endSessionUrl }: AuthProxyInput): Container {
  // Plain HTTP on loopback, where a Secure cookie never comes back.
  const origin = { redirectUrl: callbackUrl(hostPort), endSessionUrl, secureCookie: false };
  return door("auth-proxy", appName, origin, { listen: PORT, publish: hostPort });
}

/** The same proxy for the phone, which the private network forwards to from the phone's side of the app's port. */
export function buildPhoneDoorContainer({ appName, hostPort, endSessionUrl, host, loginUrl }: AuthProxyInput & PhoneSignIn): Container {
  const origin = { redirectUrl: onPhone(callbackUrl(hostPort), host), loginUrl: onPhone(loginUrl, host), endSessionUrl: onPhone(endSessionUrl, host), secureCookie: true };
  return door("phone-door", appName, origin, { listen: PHONE_DOOR_PORT, publish: phoneDoorPort(hostPort) });
}

function door(name: string, appName: string, origin: Origin, ports: { readonly listen: number; readonly publish: number }): Container {
  return {
    name,
    image: IMAGE,
    args: [...signInArgs(appName, origin), ...authorizationArgs(), ...forwardingArgs(ports.listen)],
    // Identity provider and allowed roles live in the ConfigMap, so a recipient never edits the pod.
    envFrom: [{ configMapRef: { name: authConfigName(appName) } }],
    env: secretEnv(appName),
    ports: [{ containerPort: ports.listen, hostPort: ports.publish, hostIP: LOOPBACK }],
    securityContext: HARDENED,
    resources: { limits: { cpu: "100m", memory: "64Mi" } },
  };
}

function signInArgs(appName: string, { redirectUrl, loginUrl, endSessionUrl, secureCookie }: Origin): string[] {
  return [
    "--provider=oidc",
    // The runtime answers the app's sign-out link, so the proxy's own pages live elsewhere.
    `--proxy-prefix=${PROXY_PREFIX}`,
    `--redirect-url=${redirectUrl}`,
    // A flag outranks the ConfigMap's environment variable.
    ...(loginUrl === undefined ? [] : [`--login-url=${loginUrl}`]),
    "--skip-provider-button=true",
    // Ask for consent once, not at every sign-in.
    "--approval-prompt=auto",
    // Browsers share localhost cookies across ports, so each app needs its own.
    `--cookie-name=${mayflyName(appName)}`,
    `--cookie-secure=${secureCookie}`,
    // After ending the app's session, the one place the proxy sends people on to.
    `--whitelist-domain=${new URL(endSessionUrl).host}`,
  ];
}

function authorizationArgs(): string[] {
  return [
    // Access is decided by role, not by email domain.
    "--email-domain=*",
    `--oidc-groups-claim=${ROLES_CLAIM}`,
  ];
}

function forwardingArgs(listen: number): string[] {
  return [
    `--http-address=0.0.0.0:${listen}`,
    `--upstream=http://${LOOPBACK}:${APP_PORT}/`,
    "--pass-user-headers=true",
  ];
}

// Secrets by reference only: their values never enter a spec.
function secretEnv(appName: string): EnvVar[] {
  return [
    fromSecret("OAUTH2_PROXY_CLIENT_SECRET", AUTH_SECRET_KEYS.clientSecret, appName),
    fromSecret("OAUTH2_PROXY_COOKIE_SECRET", AUTH_SECRET_KEYS.cookieSecret, appName),
  ];
}

function fromSecret(variable: string, key: string, appName: string): EnvVar {
  return { name: variable, valueFrom: { secretKeyRef: { name: authConfigName(appName), key } } };
}
