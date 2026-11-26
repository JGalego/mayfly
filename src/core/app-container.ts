import { APP_PORT, HEALTH_PATH } from "./contract.ts";
import { HARDENED } from "./hardening.ts";
import type { Container } from "./kube.ts";
import type { Manifest } from "./manifest.ts";

/** The generated code. Gets $PORT only and publishes nothing: the way in is the auth proxy. */
export function buildAppContainer(manifest: Manifest): Container {
  return {
    name: "app",
    image: manifest.image,
    imagePullPolicy: "IfNotPresent",
    env: [{ name: "PORT", value: String(APP_PORT) }],
    livenessProbe: { httpGet: { path: HEALTH_PATH, port: APP_PORT } },
    securityContext: HARDENED,
    resources: { limits: { cpu: "500m", memory: "256Mi" } },
  };
}
