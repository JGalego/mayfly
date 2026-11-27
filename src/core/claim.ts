import { HARDENED } from "./hardening.ts";
import type { PersistentVolumeClaim } from "./kube.ts";

/** A volume that outlives its pod, owned by the user every container runs as, so a hardened container can write to it. */
export function writableClaim(name: string, storage: string): PersistentVolumeClaim {
  const owner = { "volume.podman.io/uid": String(HARDENED.runAsUser), "volume.podman.io/gid": String(HARDENED.runAsGroup) };
  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: { name, annotations: owner },
    spec: { accessModes: ["ReadWriteOnce"], resources: { requests: { storage } } },
  };
}
