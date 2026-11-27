import { APP_PORT, HEALTH_CHECK, SIGN_OUT_ENV } from "./contract.ts";
import { HARDENED } from "./hardening.ts";
import type { Container } from "./kube.ts";
import type { Manifest } from "./manifest.ts";
import { execProbe } from "./probe.ts";

/** The generated code, on the runtime. Gets $PORT, and the runtime where to sign people out. Publishes nothing: the way in is the auth proxy. */
export function buildAppContainer(manifest: Manifest, signOut: Readonly<Record<string, string>>): Container {
  return {
    name: "app",
    image: manifest.image,
    imagePullPolicy: "IfNotPresent",
    env: [
      { name: "PORT", value: String(APP_PORT) },
      { name: SIGN_OUT_ENV, value: JSON.stringify(signOut) },
    ],
    livenessProbe: execProbe(HEALTH_CHECK),
    securityContext: HARDENED,
    resources: { limits: { cpu: "500m", memory: "256Mi" } },
  };
}
