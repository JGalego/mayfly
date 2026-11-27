// One shared prefix, so Mayfly finds its own pods and secrets and nothing else.

/** What Mayfly's sign-in is called under Mayfly's prefix, as an app would be. No app may have it: its pod would replace sign-in's. */
export const SIGN_IN = "dex";

export function mayflyName(appName: string): string {
  return `mayfly-${appName}`;
}

/** Names both the ConfigMap and the Secret holding an app's sign-in settings. */
export function authConfigName(appName: string): string {
  return `${mayflyName(appName)}-auth`;
}

/** Names the ConfigMap holding each of an app's auth proxies' settings file. */
export function proxyConfigName(appName: string): string {
  return `${mayflyName(appName)}-proxy`;
}

/** Names the volume an app keeps its records on. */
export function dataVolumeName(appName: string): string {
  return `${mayflyName(appName)}-data`;
}

/** Names a copy of an app's records by the copy's own id, so it keeps its name when the app is renamed. */
export function backupVolumeName(id: string): string {
  return `mayfly-backup-${id}`;
}
