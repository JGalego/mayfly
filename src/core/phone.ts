/** How an app's phone door signs people in: the computer's name on the private network, and where the computer's browser signs in. */
export interface PhoneSignIn {
  /** The computer's name on the private network, which holds a certificate for it: the phone always uses HTTPS. */
  readonly host: string;
  /** The phone signs in at the same port and path, on the host. */
  readonly loginUrl: string;
}

// The private network forwards the app's port on the host to this one on loopback.
const PHONE_PORT_OFFSET = 10_000;

/** The loopback port of an app's phone door. */
export function phonePort(hostPort: number): number {
  return hostPort + PHONE_PORT_OFFSET;
}

/** A URL the computer's browser uses, as the phone uses it: over HTTPS, at the same port and path, on the host. */
export function onPhone(url: string, host: string): string {
  const moved = new URL(url);
  moved.protocol = "https:";
  moved.hostname = host;
  return moved.toString();
}
