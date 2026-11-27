import { DATA_COPY, DATA_DIR } from "../../core/contract.ts";
import { dataVolumeName } from "../../core/names.ts";
import type { AppData } from "../../engine/ports.ts";
import { podman, run } from "./cli.ts";
import { SANDBOX } from "./sandbox.ts";

// Where the copy reads the records it copies, read-only.
const SOURCE = "/source";

/** Apps' records on Podman volumes, copied by the runtime image. */
export function podmanData(runtimeImage: string): AppData {
  return { copy: (from, to) => copyData(runtimeImage, dataVolumeName(from), dataVolumeName(to)) };
}

/**
 * Copies the records on one volume to another, which Podman makes for the app's user when it's new. Podman would make the
 * source too, empty, so a source that doesn't exist copies nothing. The image is any built on the runtime.
 */
export async function copyData(image: string, from: string, to: string): Promise<void> {
  if ((await run(["volume", "exists", from])).code !== 0) return;
  await podman(["run", "--rm", ...SANDBOX, "--volume", `${from}:${SOURCE}:ro`, "--volume", `${to}:${DATA_DIR}:U`, "--entrypoint", JSON.stringify(DATA_COPY), image, SOURCE, DATA_DIR]);
}
