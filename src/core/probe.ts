import type { Probe } from "./kube.ts";

/** Podman runs httpGet probes as curl through a shell, which minimal images lack, so Mayfly probes by running a command. */
export function execProbe(command: readonly string[]): Probe {
  return { exec: { command }, periodSeconds: 10, timeoutSeconds: 5, failureThreshold: 3 };
}
