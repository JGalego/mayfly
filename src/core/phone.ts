/** Where the phone reaches this computer: its name on a private network, over HTTPS or plain HTTP. */
export interface PhoneAddress {
  readonly host: string;
  readonly scheme: "https" | "http";
}

/** How an app's phone door signs people in: the phone's address, and where the computer's browser signs in. */
export interface PhoneSignIn {
  readonly address: PhoneAddress;
  /** The phone signs in at the same port and path, on its own address. */
  readonly loginUrl: string;
}

// The private network forwards the app's port on the phone's address to this one on loopback.
const PHONE_PORT_OFFSET = 10_000;

/** The loopback port of an app's phone door. */
export function phonePort(hostPort: number): number {
  return hostPort + PHONE_PORT_OFFSET;
}

/** A URL the computer's browser uses, as the phone uses it: the same port and path, on the phone's address. */
export function onPhone(url: string, phone: PhoneAddress): string {
  const moved = new URL(url);
  moved.protocol = `${phone.scheme}:`;
  moved.hostname = phone.host;
  return moved.toString();
}
