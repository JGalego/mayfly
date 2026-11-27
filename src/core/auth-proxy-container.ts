import { callbackUrl } from "./app-url.ts";
import { AUTH_SECRET_KEYS } from "./auth-secret.ts";
import { PROXY_PREFIX } from "./contract.ts";
import { HARDENED, LOOPBACK } from "./hardening.ts";
import type { ConfigMap, ConfigMapVolume, Container, EnvVar } from "./kube.ts";
import { authConfigName, mayflyName, proxyConfigName } from "./names.ts";
import { onPhone, phoneDoorPort, type PhoneSignIn } from "./phone.ts";
import { proxyConfig } from "./proxy-config.ts";

// Pinned: every app runs the proxy the contract was tested against.
const IMAGE = "quay.io/oauth2-proxy/oauth2-proxy:v7.15.6";
const PORT = 4180;
// The phone door shares the pod's network with the localhost door, so it listens on the next port.
const PHONE_DOOR_PORT = 4181;
const COMPUTER_DOOR = "auth-proxy";
const PHONE_DOOR = "phone-door";
const CONFIG_VOLUME = "proxy-config";
const CONFIG_DIR = "/etc/oauth2-proxy";

export interface AuthProxyInput {
  readonly appName: string;
  readonly hostPort: number;
  /** Where the computer's browser ends its session with the identity provider. */
  readonly endSessionUrl: string;
}

/** Where a door sends people back to after they sign in, and how it keeps their session. */
interface Origin {
  readonly redirectUrl: string;
  /** Where this door's browser ends its session with the identity provider, after the app's. */
  readonly endSessionUrl: string;
  readonly secureCookie: boolean;
}

/**
 * Signs people in, admits only the policy's roles, and passes identity to the app in headers, without the browser's cookies.
 * No liveness probe: the image is one binary with nothing to run a probe with. A crash still restarts it.
 */
export function buildAuthProxyContainer({ appName, hostPort, endSessionUrl }: AuthProxyInput): Container {
  // Plain HTTP on loopback, where a Secure cookie never comes back.
  const origin = { redirectUrl: callbackUrl(hostPort), endSessionUrl, secureCookie: false };
  return door(COMPUTER_DOOR, appName, origin, { listen: PORT, publish: hostPort });
}

/** The same proxy for the phone, which the private network forwards to from the phone's side of the app's port. */
export function buildPhoneDoorContainer({ appName, hostPort, endSessionUrl, host }: AuthProxyInput & PhoneSignIn): Container {
  const origin = { redirectUrl: onPhone(callbackUrl(hostPort), host), endSessionUrl: onPhone(endSessionUrl, host), secureCookie: true };
  return door(PHONE_DOOR, appName, origin, { listen: PHONE_DOOR_PORT, publish: phoneDoorPort(hostPort) });
}

/** A settings file for each door the pod has. The phone's sends it to sign in on the phone's address. */
export function buildProxyConfigMap(appName: string, phone?: PhoneSignIn): ConfigMap {
  const computer = { [settingsFile(COMPUTER_DOOR)]: proxyConfig({ listen: PORT }) };
  const phoneDoor = phone === undefined ? {} : { [settingsFile(PHONE_DOOR)]: proxyConfig({ listen: PHONE_DOOR_PORT, loginUrl: onPhone(phone.loginUrl, phone.host) }) };
  return { apiVersion: "v1", kind: "ConfigMap", metadata: { name: proxyConfigName(appName) }, data: { ...computer, ...phoneDoor } };
}

/** Where the doors read their settings files from. */
export function proxyConfigVolume(appName: string): ConfigMapVolume {
  return { name: CONFIG_VOLUME, configMap: { name: proxyConfigName(appName) } };
}

function door(name: string, appName: string, origin: Origin, ports: { readonly listen: number; readonly publish: number }): Container {
  return {
    name,
    image: IMAGE,
    args: [`--alpha-config=${CONFIG_DIR}/${settingsFile(name)}`, ...signInArgs(appName, origin)],
    // Identity provider and allowed roles live in the ConfigMap, so a recipient never edits the pod.
    envFrom: [{ configMapRef: { name: authConfigName(appName) } }],
    env: secretEnv(appName),
    ports: [{ containerPort: ports.listen, hostPort: ports.publish, hostIP: LOOPBACK }],
    volumeMounts: [{ name: CONFIG_VOLUME, mountPath: CONFIG_DIR, readOnly: true }],
    securityContext: HARDENED,
    resources: { limits: { cpu: "100m", memory: "64Mi" } },
  };
}

function signInArgs(appName: string, { redirectUrl, endSessionUrl, secureCookie }: Origin): string[] {
  return [
    // The runtime answers the app's sign-out link, so the proxy's own pages live elsewhere.
    `--proxy-prefix=${PROXY_PREFIX}`,
    `--redirect-url=${redirectUrl}`,
    "--skip-provider-button=true",
    // Browsers share localhost cookies across ports, so each app needs its own.
    `--cookie-name=${mayflyName(appName)}`,
    `--cookie-secure=${secureCookie}`,
    // After ending the app's session, the one place the proxy sends people on to.
    `--whitelist-domain=${new URL(endSessionUrl).host}`,
    // Access is decided by role, not by email domain.
    "--email-domain=*",
  ];
}

function settingsFile(door: string): string {
  return `${door}.yaml`;
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
