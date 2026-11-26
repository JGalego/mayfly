// One shared prefix, so Mayfly finds its own pods and secrets and nothing else.

export function mayflyName(appName: string): string {
  return `mayfly-${appName}`;
}

export function authSecretName(appName: string): string {
  return `${mayflyName(appName)}-auth`;
}
