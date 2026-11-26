import type { SecurityContext } from "./kube.ts";

const NOBODY = 65534;

/** Mayfly publishes ports on this address only. */
export const LOOPBACK = "127.0.0.1";

/** Applied to every container. Not derived from the manifest, so no app can opt out. */
export const HARDENED: SecurityContext = {
  runAsNonRoot: true,
  runAsUser: NOBODY,
  runAsGroup: NOBODY,
  allowPrivilegeEscalation: false,
  readOnlyRootFilesystem: true,
  capabilities: { drop: ["ALL"] },
};
