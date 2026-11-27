import { APP_PORT, DATA_DIR, HEALTH_CHECK, SIGN_OUT_ENV } from "./contract.ts";
import { HARDENED } from "./hardening.ts";
import type { Container } from "./kube.ts";
import type { Manifest } from "./manifest.ts";
import { execProbe } from "./probe.ts";

/** The volume an app that keeps data writes its records to, in its pod's list of volumes. */
export const DATA_VOLUME = "data";

/**
 * The generated code, on the runtime. Gets $PORT, the runtime where to sign people out, and when it keeps data, its own volume.
 * Publishes nothing: the way in is the auth proxy.
 */
export function buildAppContainer(manifest: Manifest, signOut: Readonly<Record<string, string>>, keepsData: boolean): Container {
  return {
    name: "app",
    image: manifest.image,
    imagePullPolicy: "IfNotPresent",
    env: [
      { name: "PORT", value: String(APP_PORT) },
      { name: SIGN_OUT_ENV, value: JSON.stringify(signOut) },
    ],
    ...(keepsData ? { volumeMounts: [{ name: DATA_VOLUME, mountPath: DATA_DIR, readOnly: false }] } : {}),
    livenessProbe: execProbe(HEALTH_CHECK),
    securityContext: HARDENED,
    resources: { limits: { cpu: "500m", memory: "256Mi" } },
  };
}
