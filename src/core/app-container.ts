import { APP_PORT, HEALTH_CHECK } from "./contract.ts";
import { HARDENED } from "./hardening.ts";
import type { Container } from "./kube.ts";
import type { Manifest } from "./manifest.ts";
import { execProbe } from "./probe.ts";

/** The generated code. Gets $PORT only and publishes nothing: the way in is the auth proxy. */
export function buildAppContainer(manifest: Manifest): Container {
  return {
    name: "app",
    image: manifest.image,
    imagePullPolicy: "IfNotPresent",
    env: [{ name: "PORT", value: String(APP_PORT) }],
    livenessProbe: execProbe(HEALTH_CHECK),
    securityContext: HARDENED,
    resources: { limits: { cpu: "500m", memory: "256Mi" } },
  };
}
