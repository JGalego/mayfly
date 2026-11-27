import { DATA_COPY, DATA_DIR, DATA_EXPORT } from "../../core/contract.ts";
import type { AppData } from "../../engine/ports.ts";
import { podman, run } from "./cli.ts";
import { removeVolume } from "./podman.ts";
import { SANDBOX } from "./sandbox.ts";

// Where the copy reads the records it copies, read-only.
const SOURCE = "/source";

/** Apps' records on Podman volumes, copied and exported by the runtime image. */
export function podmanData(runtimeImage: string): AppData {
  return { copy: (from, to) => copyData(runtimeImage, from, to), remove: removeVolume, export: (volume) => exportData(runtimeImage, volume) };
}

/**
 * Copies the records on one volume to another, which Podman makes for the app's user when it's new. Podman would make the
 * source too, empty, so a source that doesn't exist copies nothing. The image is any built on the runtime.
 */
export async function copyData(image: string, from: string, to: string): Promise<void> {
  if ((await run(["volume", "exists", from])).code !== 0) return;
  await podman(["run", "--rm", ...SANDBOX, "--volume", `${from}:${SOURCE}:ro`, "--volume", `${to}:${DATA_DIR}:U`, "--entrypoint", JSON.stringify(DATA_COPY), image, SOURCE, DATA_DIR]);
}

/** Every record on a volume, as JSON by key. A volume that doesn't exist has none. */
async function exportData(image: string, volume: string): Promise<string> {
  if ((await run(["volume", "exists", volume])).code !== 0) return "{}\n";
  return podman(["run", "--rm", ...SANDBOX, "--volume", `${volume}:${SOURCE}:ro`, "--entrypoint", JSON.stringify(DATA_EXPORT), image, SOURCE]);
}
