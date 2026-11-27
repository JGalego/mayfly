import { hash } from "bcryptjs";
import type { IdpSettings } from "../../core/auth-config-map.ts";
import { HARDENED, LOOPBACK } from "../../core/hardening.ts";
import type { ConfigMap, KubeObject, Pod, Secret, Volume, VolumeMount } from "../../core/kube.ts";
import { execProbe } from "../../core/probe.ts";

// Pinned: v2.45 is the first release that gives static users groups.
const IMAGE = "ghcr.io/dexidp/dex:v2.46.1";
const NAME = "mayfly-dex";
export const DEX_POD = NAME;
const CONFIG = `${NAME}-config`;
const BRAND = `${NAME}-brand`;
// Dex serves its pages from here, and anything in static/ as is.
const WEB = "/srv/dex/web";
const LOGO = "static/mayfly/logo.svg";
// Where Dex listens in its pod, and on loopback unless another program holds that port.
const PORT = 5556;
export const PREFERRED_SIGN_IN_PORT = PORT;
// Inside a pod, localhost is the pod itself, so auth proxies reach Dex by name on the Mayfly network.
const ON_NETWORK = `http://${NAME}:${PORT}/dex`;

export interface DexUser {
  readonly email: string;
  readonly username: string;
  readonly password: string;
  readonly groups: readonly string[];
}

export interface DexClient {
  readonly id: string;
  readonly secret: string;
  readonly redirectUris: readonly string[];
}

export interface DexInput {
  readonly users: readonly DexUser[];
  readonly clients: readonly DexClient[];
  /** An SVG logo for the sign-in page, which otherwise shows Dex's own. */
  readonly logo?: string;
  /** The loopback port people sign in on. */
  readonly port?: number;
}

/** The local identity provider: a pod published on loopback, configured from a Secret, its sign-in page named for Mayfly. */
export async function buildDex({ users, clients, logo, port = PREFERRED_SIGN_IN_PORT }: DexInput): Promise<KubeObject[]> {
  const frontend = logo === undefined ? { issuer: "Mayfly" } : { issuer: "Mayfly", dir: WEB, logoURL: LOGO };
  const config = {
    issuer: issuerOn(port),
    frontend,
    storage: { type: "memory" },
    web: { http: `0.0.0.0:${PORT}` },
    oauth2: { skipApprovalScreen: true },
    enablePasswordDB: true,
    staticPasswords: await Promise.all(users.map(staticPassword)),
    staticClients: clients.map(staticClient),
  };
  const brand: ConfigMap[] = logo === undefined ? [] : [{ apiVersion: "v1", kind: "ConfigMap", metadata: { name: BRAND }, data: { "logo.svg": logo } }];
  return [configSecret(config), ...brand, dexPod(brand.length > 0, port)];
}

/** How an app's auth proxy signs people in with Dex: the browser uses the issuer, the proxy uses the network. */
export function dexSettings(clientId: string, port = PREFERRED_SIGN_IN_PORT): IdpSettings {
  const issuer = issuerOn(port);
  return {
    OAUTH2_PROXY_OIDC_ISSUER_URL: issuer,
    OAUTH2_PROXY_CLIENT_ID: clientId,
    OAUTH2_PROXY_SCOPE: "openid email profile groups",
    OAUTH2_PROXY_SKIP_OIDC_DISCOVERY: "true",
    OAUTH2_PROXY_LOGIN_URL: `${issuer}/auth`,
    OAUTH2_PROXY_REDEEM_URL: `${ON_NETWORK}/token`,
    OAUTH2_PROXY_OIDC_JWKS_URL: `${ON_NETWORK}/keys`,
  };
}

async function staticPassword({ email, username, password, groups }: DexUser) {
  return { email, username, userID: username, groups, hash: await hash(password, 10) };
}

function staticClient({ id, secret, redirectUris }: DexClient) {
  return { id, secret, name: id, redirectURIs: redirectUris };
}

// A Secret, not a ConfigMap: the config holds client secrets and password hashes.
function configSecret(config: object): Secret {
  return { apiVersion: "v1", kind: "Secret", metadata: { name: CONFIG }, stringData: { "config.yaml": JSON.stringify(config) } };
}

/** Where browsers sign in, on the loopback port Dex is published on. */
function issuerOn(port: number): string {
  return `http://localhost:${port}/dex`;
}

function dexPod(branded: boolean, port: number): Pod {
  const volumes: Volume[] = [{ name: "config", secret: { secretName: CONFIG } }];
  const mounts: VolumeMount[] = [{ name: "config", mountPath: "/etc/dex", readOnly: true }];
  if (branded) {
    volumes.push({ name: "brand", configMap: { name: BRAND } });
    mounts.push({ name: "brand", mountPath: `${WEB}/static/mayfly`, readOnly: true });
  }
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: { name: NAME },
    spec: {
      containers: [
        {
          name: "dex",
          image: IMAGE,
          args: ["dex", "serve", "/etc/dex/config.yaml"],
          ports: [{ containerPort: PORT, hostPort: port, hostIP: LOOPBACK }],
          volumeMounts: mounts,
          livenessProbe: execProbe(["wget", "-q", "--spider", `http://127.0.0.1:${PORT}/dex/healthz`]),
          securityContext: HARDENED,
          resources: { limits: { cpu: "100m", memory: "128Mi" } },
        },
      ],
      volumes,
    },
  };
}
