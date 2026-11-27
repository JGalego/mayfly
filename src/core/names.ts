// One shared prefix, so Mayfly finds its own pods and secrets and nothing else.

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
