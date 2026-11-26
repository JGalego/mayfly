import { hash } from "bcryptjs";
import type { IdpSettings } from "../../core/auth-config-map.ts";
import { HARDENED, LOOPBACK } from "../../core/hardening.ts";
import type { KubeObject, Pod, Secret } from "../../core/kube.ts";
import { execProbe } from "../../core/probe.ts";

// Pinned: v2.45 is the first release that gives static users groups.
const IMAGE = "ghcr.io/dexidp/dex:v2.46.1";
const NAME = "mayfly-dex";
const CONFIG = `${NAME}-config`;
const PORT = 5556;
const ISSUER = `http://localhost:${PORT}/dex`;
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
  readonly redirectUri: string;
}

export interface DexInput {
  readonly users: readonly DexUser[];
  readonly clients: readonly DexClient[];
}

/** The local identity provider: a pod published on loopback, configured from a Secret. */
export async function buildDex({ users, clients }: DexInput): Promise<KubeObject[]> {
  const config = {
    issuer: ISSUER,
    storage: { type: "memory" },
    web: { http: `0.0.0.0:${PORT}` },
    oauth2: { skipApprovalScreen: true },
    enablePasswordDB: true,
    staticPasswords: await Promise.all(users.map(staticPassword)),
    staticClients: clients.map(staticClient),
  };
  return [configSecret(config), dexPod()];
}

/** How an app's auth proxy signs people in with Dex: the browser uses the issuer, the proxy uses the network. */
export function dexSettings(clientId: string): IdpSettings {
  return {
    OAUTH2_PROXY_OIDC_ISSUER_URL: ISSUER,
    OAUTH2_PROXY_CLIENT_ID: clientId,
    OAUTH2_PROXY_SCOPE: "openid email profile groups",
    OAUTH2_PROXY_SKIP_OIDC_DISCOVERY: "true",
    OAUTH2_PROXY_LOGIN_URL: `${ISSUER}/auth`,
    OAUTH2_PROXY_REDEEM_URL: `${ON_NETWORK}/token`,
    OAUTH2_PROXY_OIDC_JWKS_URL: `${ON_NETWORK}/keys`,
  };
}

async function staticPassword({ email, username, password, groups }: DexUser) {
  return { email, username, userID: username, groups, hash: await hash(password, 10) };
}

function staticClient({ id, secret, redirectUri }: DexClient) {
  return { id, secret, name: id, redirectURIs: [redirectUri] };
}

// A Secret, not a ConfigMap: the config holds client secrets and password hashes.
function configSecret(config: object): Secret {
  return { apiVersion: "v1", kind: "Secret", metadata: { name: CONFIG }, stringData: { "config.yaml": JSON.stringify(config) } };
}

function dexPod(): Pod {
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
          ports: [{ containerPort: PORT, hostPort: PORT, hostIP: LOOPBACK }],
          volumeMounts: [{ name: "config", mountPath: "/etc/dex", readOnly: true }],
          livenessProbe: execProbe(["wget", "-q", "--spider", `http://127.0.0.1:${PORT}/dex/healthz`]),
          securityContext: HARDENED,
          resources: { limits: { cpu: "100m", memory: "128Mi" } },
        },
      ],
      volumes: [{ name: "config", secret: { secretName: CONFIG } }],
    },
  };
}
