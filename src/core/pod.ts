import { buildAppContainer } from "./app-container.ts";
import { buildAuthProxyContainer, buildPhoneDoorContainer } from "./auth-proxy-container.ts";
import type { Pod } from "./kube.ts";
import type { Manifest } from "./manifest.ts";
import { mayflyName } from "./names.ts";
import type { PhoneSignIn } from "./phone.ts";

export interface PodInput {
  readonly manifest: Manifest;
  /** Loopback port people open the app on. */
  readonly hostPort: number;
  /** With phone access on, a second door for the phone. */
  readonly phone?: PhoneSignIn;
}

/** One app behind its auth proxy, in the shape `podman kube play` takes. */
export function buildPod({ manifest, hostPort, phone }: PodInput): Pod {
  const appName = manifest.name;
  const phoneDoor = phone === undefined ? [] : [buildPhoneDoorContainer({ appName, hostPort, ...phone })];
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: { name: mayflyName(appName) },
    spec: {
      containers: [buildAuthProxyContainer({ appName, hostPort }), ...phoneDoor, buildAppContainer(manifest)],
    },
  };
}
