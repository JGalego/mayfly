import { buildAppContainer, DATA_VOLUME } from "./app-container.ts";
import { APP_PORT } from "./contract.ts";
import { appUrl } from "./app-url.ts";
import { buildAuthProxyContainer, buildPhoneDoorContainer, proxyConfigVolume } from "./auth-proxy-container.ts";
import { writableClaim } from "./claim.ts";
import type { PersistentVolumeClaim, Pod, Volume } from "./kube.ts";
import type { Manifest } from "./manifest.ts";
import { dataVolumeName, mayflyName } from "./names.ts";
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
  /** The app keeps records, on a volume of its own. */
  readonly keepsData?: boolean;
}

/** The volume an app keeps its records on, as large as the runtime's store lets them grow. */
export function buildDataClaim(appName: string): PersistentVolumeClaim {
  return writableClaim(dataVolumeName(appName), "100M");
}

/** One app behind its auth proxy, in the shape `podman kube play` takes. */
export function buildPod({ manifest, hostPort, endSessionUrl, phone, keepsData = false }: PodInput): Pod {
  const appName = manifest.name;
  const phoneDoor = phone === undefined ? [] : [buildPhoneDoorContainer({ appName, hostPort, endSessionUrl, ...phone })];
  const data: Volume[] = keepsData ? [{ name: DATA_VOLUME, persistentVolumeClaim: { claimName: dataVolumeName(appName) } }] : [];
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: { name: mayflyName(appName) },
    spec: {
      containers: [buildAuthProxyContainer({ appName, hostPort, endSessionUrl }), ...phoneDoor, buildAppContainer(manifest, signOutTargets(doors(hostPort, endSessionUrl, phone)), keepsData)],
      volumes: [proxyConfigVolume(appName), ...data],
      // Every port below the app's is privileged in the pod, so only the proxies, which may, can listen on theirs. Were the app
      // to take a proxy's port while it restarted, it would answer the browser itself, and hear every cookie it sends.
      securityContext: { sysctls: [{ name: "net.ipv4.ip_unprivileged_port_start", value: String(APP_PORT) }] },
    },
  };
}

function doors(hostPort: number, endSessionUrl: string, phone: PhoneSignIn | undefined): Door[] {
  const computer = { appUrl: appUrl(hostPort), endSessionUrl };
  if (phone === undefined) return [computer];
  return [computer, { appUrl: onPhone(computer.appUrl, phone.host), endSessionUrl: onPhone(endSessionUrl, phone.host) }];
}
