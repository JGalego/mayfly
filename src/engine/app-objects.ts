import { buildAuthConfigMap, type IdpSettings } from "../core/auth-config-map.ts";
import { buildAuthSecret } from "../core/auth-secret.ts";
import type { KubeObject } from "../core/kube.ts";
import { buildPod } from "../core/pod.ts";
import { OWNER_ROLE, type App } from "./state.ts";

/** What runs an app's image: its sign-in settings, its secrets and its pod. */
export function appObjects(app: App, image: string, idp: IdpSettings): KubeObject[] {
  const appName = app.name;
  return [
    buildAuthConfigMap({ appName, policy: { roles: [OWNER_ROLE] }, idp }),
    buildAuthSecret({ appName, clientSecret: app.clientSecret, cookieSecret: app.cookieSecret }),
    buildPod({ manifest: { name: appName, image }, hostPort: app.hostPort }),
  ];
}
