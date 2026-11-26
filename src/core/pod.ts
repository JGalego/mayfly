import { buildAppContainer } from "./app-container.ts";
import { buildAuthProxyContainer, type OidcClient } from "./auth-proxy-container.ts";
import type { Pod } from "./kube.ts";
import type { Manifest } from "./manifest.ts";
import { mayflyName } from "./names.ts";
import type { Policy } from "./policy.ts";

export interface PodInput {
  readonly manifest: Manifest;
  readonly policy: Policy;
  readonly idp: OidcClient;
  /** Loopback port people open the app on. */
  readonly hostPort: number;
}

/** One app behind its auth proxy, in the shape `podman kube play` takes. */
export function buildPod({ manifest, policy, idp, hostPort }: PodInput): Pod {
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: { name: mayflyName(manifest.name) },
    spec: {
      containers: [
        buildAuthProxyContainer({ appName: manifest.name, policy, idp, hostPort }),
        buildAppContainer(manifest),
      ],
    },
  };
}
