import { toKubeYaml } from "../../core/kube-yaml.ts";
import type { KubeObject } from "../../core/kube.ts";
import type { ContainerHealth, Deployer, Observer } from "../../engine/ports.ts";
import { podman, run } from "./cli.ts";

/** Every Mayfly pod joins this network, so auth proxies can reach Dex by name. */
const NETWORK = "mayfly";

export const podmanDeployer: Deployer = { deploy: play, remove: down };

export const podmanObserver: Observer = { health };

/** The fields of `podman ps --format json` that say how a container is doing. */
interface Listed {
  readonly Names: readonly string[];
  readonly PodName: string;
  readonly IsInfra: boolean;
  readonly State: string;
  readonly Status: string;
  readonly Restarts: number;
}

/** How the named pods' containers are doing, leaving out each pod's infra container, which only holds it together. */
export async function health(pods: readonly string[]): Promise<{ pod: string; containers: ContainerHealth[] }[]> {
  const listed = (JSON.parse(await podman(["ps", "--all", "--pod", "--format", "json", "--filter", "name=^mayfly-"])) as Listed[] | null) ?? [];
  return pods.flatMap((pod) => {
    const containers = listed.filter((entry) => entry.PodName === pod && !entry.IsInfra);
    return containers.length === 0 ? [] : [{ pod, containers: containers.map((entry) => containerHealth(pod, entry)) }];
  });
}

function containerHealth(pod: string, { Names, State, Status, Restarts }: Listed): ContainerHealth {
  const name = (Names[0] ?? "").replace(`${pod}-`, "");
  return { name, state: State, status: Status, restarts: Restarts };
}

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
