import { buildAuthConfigMap, type IdpSettings } from "../core/auth-config-map.ts";
import { buildProxyConfigMap } from "../core/auth-proxy-container.ts";
import { buildAuthSecret } from "../core/auth-secret.ts";
import type { KubeObject } from "../core/kube.ts";
import type { PhoneSignIn } from "../core/phone.ts";
import { buildDataClaim, buildPod } from "../core/pod.ts";
import type { SignInSettings } from "../core/sign-out.ts";
import { OWNER_ROLE, type App } from "./state.ts";

/**
 * What runs an app's image: its sign-in settings and whom they let in, its proxy's settings, its secrets, the volume it keeps
 * records on if it keeps any, and its pod, with a phone door while phone access is on.
 */
export function appObjects(app: App, image: string, { proxy, endSessionUrl }: SignInSettings, phoneHost: string | null = null, groups: readonly string[] = [OWNER_ROLE]): KubeObject[] {
  const appName = app.name;
  const phone = phoneHost === null ? undefined : phoneSignIn(phoneHost, proxy);
  const keepsData = app.keepsData === true;
  return [
    buildAuthConfigMap({ appName, policy: { roles: groups }, idp: proxy }),
    buildProxyConfigMap(appName, phone),
    buildAuthSecret({ appName, clientSecret: app.clientSecret, cookieSecret: app.cookieSecret }),
    ...(keepsData ? [buildDataClaim(appName)] : []),
    buildPod({ manifest: { name: appName, image }, hostPort: app.hostPort, endSessionUrl, keepsData, ...(phone === undefined ? {} : { phone }) }),
  ];
}

function phoneSignIn(host: string, idp: IdpSettings): PhoneSignIn {
  const loginUrl = idp.OAUTH2_PROXY_LOGIN_URL;
  // The phone signs in where the computer does, on its own address, so it needs to know where that is.
  if (loginUrl === undefined) throw new Error("The identity provider names no sign-in page for the phone");
  return { host, loginUrl };
}
