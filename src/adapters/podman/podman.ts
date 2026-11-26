import { toKubeYaml } from "../../core/kube-yaml.ts";
import type { KubeObject } from "../../core/kube.ts";
import type { Deployer } from "../../engine/ports.ts";
import { podman, run } from "./cli.ts";

/** Every Mayfly pod joins this network, so auth proxies can reach Dex by name. */
const NETWORK = "mayfly";

export const podmanDeployer: Deployer = { deploy: play, remove: down };

/** Creates the objects' pods and secrets, replacing any that already exist. */
export async function play(objects: readonly KubeObject[]): Promise<void> {
  await ensureNetwork();
  await podman(["kube", "play", "--replace", "--network", NETWORK, "-"], toKubeYaml(objects));
}

/** Stops and removes the objects' pods and secrets. */
export async function down(objects: readonly KubeObject[]): Promise<void> {
  await podman(["kube", "down", "-"], toKubeYaml(objects));
}

async function ensureNetwork(): Promise<void> {
  const { code } = await run(["network", "exists", NETWORK]);
  if (code !== 0) await podman(["network", "create", NETWORK]);
}
