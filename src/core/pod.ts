import { buildAppContainer } from "./app-container.ts";
import { buildAuthProxyContainer } from "./auth-proxy-container.ts";
import type { Pod } from "./kube.ts";
import type { Manifest } from "./manifest.ts";
import { mayflyName } from "./names.ts";

export interface PodInput {
  readonly manifest: Manifest;
  /** Loopback port people open the app on. */
  readonly hostPort: number;
}

/** One app behind its auth proxy, in the shape `podman kube play` takes. */
export function buildPod({ manifest, hostPort }: PodInput): Pod {
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: { name: mayflyName(manifest.name) },
    spec: {
      containers: [buildAuthProxyContainer({ appName: manifest.name, hostPort }), buildAppContainer(manifest)],
    },
  };
}
