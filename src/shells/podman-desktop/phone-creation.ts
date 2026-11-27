import { onPhone, phoneSidePort } from "../../core/phone.ts";
import type { PhoneNetwork } from "../../engine/ports.ts";
import type { PhoneServer } from "./phone-server.ts";

// Just below the first app's port. If something else holds it, the page takes one further down, never an app's.
const PAGE_PORT = 18099;
const PAGE_PORTS = Array.from({ length: 10 }, (_, below) => PAGE_PORT - below);
// The phone always uses this one: it's part of the page's origin, which holds the phone's pairing.
const PHONE_SIDE = phoneSidePort(PAGE_PORT);

/** The phone page's address on the phone. */
export function phonePageUrl(host: string): string {
  return onPhone(`http://localhost:${PAGE_PORT}/`, host);
}

export interface PhoneCreationPorts {
  readonly startServer: (candidates: readonly number[]) => Promise<PhoneServer>;
  readonly network: Pick<PhoneNetwork, "serve" | "stop">;
}

export interface PhoneCreation {
  /** Serves the phone page and puts it on the private network. */
  start(): Promise<void>;
  /** Takes the phone page off the private network and stops serving it. */
  stop(): Promise<void>;
  /** Stops serving the phone page, as Podman Desktop closes, and leaves it on the private network, which then says Mayfly isn't answering. */
  close(): Promise<void>;
}

export function phoneCreation({ startServer, network }: PhoneCreationPorts): PhoneCreation {
  let server: PhoneServer | undefined;
  const close = async (): Promise<void> => {
    await server?.close();
    server = undefined;
  };
  return {
    async start() {
      if (server !== undefined) return;
      const started = await startServer(PAGE_PORTS);
      try {
        await network.serve(PHONE_SIDE, started.port);
      } catch (error) {
        await started.close();
        throw error;
      }
      server = started;
    },
    async stop() {
      await network.stop(PHONE_SIDE);
      await close();
    },
    close,
  };
}
