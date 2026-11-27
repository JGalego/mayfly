/** How an app's phone door signs people in: the computer's name on the private network, and where the computer's browser signs in. */
export interface PhoneSignIn {
  /** The computer's name on the private network, which holds a certificate for it: the phone always uses HTTPS. */
  readonly host: string;
  /** The phone signs in at the same port and path, on the host. */
  readonly loginUrl: string;
}

// An app's phone door listens this far above the app's port, on loopback.
const PHONE_DOOR_OFFSET = 10_000;
// The phone reaches each port this far above it, so the private network never listens on a number Podman publishes.
// Under WSL's mirrored networking the two would collide whatever their addresses.
const PHONE_SIDE_OFFSET = 20_000;

/** The loopback port of an app's phone door. */
export function phoneDoorPort(hostPort: number): number {
  return hostPort + PHONE_DOOR_OFFSET;
}

/** The port the phone uses on the host for what the computer reaches on this loopback port. */
export function phoneSidePort(port: number): number {
  return port + PHONE_SIDE_OFFSET;
}

/** A URL the computer's browser uses, as the phone uses it: over HTTPS, on the host, on the phone's side of its port. */
export function onPhone(url: string, host: string): string {
  const moved = new URL(url);
  moved.protocol = "https:";
  moved.hostname = host;
  moved.port = String(phoneSidePort(Number(moved.port)));
  return moved.toString();
}
