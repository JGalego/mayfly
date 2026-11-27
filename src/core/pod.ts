import { buildAppContainer } from "./app-container.ts";
import { appUrl } from "./app-url.ts";
import { buildAuthProxyContainer, buildPhoneDoorContainer } from "./auth-proxy-container.ts";
import type { Pod } from "./kube.ts";
import type { Manifest } from "./manifest.ts";
import { mayflyName } from "./names.ts";
import { onPhone, type PhoneSignIn } from "./phone.ts";
import { signOutTargets, type Door } from "./sign-out.ts";

export interface PodInput {
  readonly manifest: Manifest;
  /** Loopback port people open the app on. */
  readonly hostPort: number;
  /** Where the computer's browser ends its session with the identity provider. */
  readonly endSessionUrl: string;
  /** With phone access on, a second door for the phone. */
  readonly phone?: PhoneSignIn;
}

/** One app behind its auth proxy, in the shape `podman kube play` takes. */
export function buildPod({ manifest, hostPort, endSessionUrl, phone }: PodInput): Pod {
  const appName = manifest.name;
  const phoneDoor = phone === undefined ? [] : [buildPhoneDoorContainer({ appName, hostPort, endSessionUrl, ...phone })];
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: { name: mayflyName(appName) },
    spec: {
      containers: [buildAuthProxyContainer({ appName, hostPort, endSessionUrl }), ...phoneDoor, buildAppContainer(manifest, signOutTargets(doors(hostPort, endSessionUrl, phone)))],
    },
  };
}

function doors(hostPort: number, endSessionUrl: string, phone: PhoneSignIn | undefined): Door[] {
  const computer = { appUrl: appUrl(hostPort), endSessionUrl };
  if (phone === undefined) return [computer];
  return [computer, { appUrl: onPhone(computer.appUrl, phone.host), endSessionUrl: onPhone(endSessionUrl, phone.host) }];
}
