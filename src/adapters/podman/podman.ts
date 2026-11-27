import { toKubeYaml } from "../../core/kube-yaml.ts";
import type { KubeObject } from "../../core/kube.ts";
import type { ContainerHealth, Deployer, Observer } from "../../engine/ports.ts";
import { podman, run } from "./cli.ts";

/** Every Mayfly pod joins this network, so auth proxies can reach Dex by name. */
const NETWORK = "mayfly";

// An app's only volume is the copy Podman makes of its proxy's settings, which would outlive the app.
export const podmanDeployer: Deployer = { deploy: play, remove: (objects) => down(objects, { volumes: true }) };

export const podmanObserver: Observer = { health, logs };

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

/** What a container wrote to stdout and stderr, merged by time. */
export async function logs(pod: string, container: string, lines: number): Promise<string[]> {
  const { code, stdout, stderr } = await run(["logs", "--tail", String(lines), "--timestamps", `${pod}-${container}`]);
  if (code !== 0) throw new Error(`podman logs failed: ${stderr.trim()}`);
  return [...stdout.split("\n"), ...stderr.split("\n")].filter((line) => line !== "").sort();
}

/** Podman's own version and its machine's, the machine's null when it does not answer, or undefined with no Podman at all. */
export async function versions(): Promise<{ client: string; server: string | null } | undefined> {
  const client = await run(["version", "--format", "{{.Client.Version}}"]).catch(() => undefined);
  if (client === undefined || client.code !== 0) return undefined;
  const server = await run(["info", "--format", "{{.Version.Version}}"]);
  return { client: client.stdout.trim(), server: server.code === 0 ? server.stdout.trim() : null };
}

export async function imageExists(image: string): Promise<boolean> {
  return (await run(["image", "exists", image])).code === 0;
}

// Podman tells what a health check found only in its summary: "Up 5 minutes (healthy)".
const VERDICT = /\((starting|healthy|unhealthy)\)$/;

function containerHealth(pod: string, { Names, State, Status, Restarts }: Listed): ContainerHealth {
  const name = (Names[0] ?? "").replace(`${pod}-`, "");
  const verdict = VERDICT.exec(Status)?.[1] as ContainerHealth["health"];
  return { name, state: State, status: Status, restarts: Restarts, ...(verdict === undefined ? {} : { health: verdict }) };
}

/** Creates the objects' pods and secrets, replacing any that already exist. */
export async function play(objects: readonly KubeObject[]): Promise<void> {
  await ensureNetwork();
  await podman(["kube", "play", "--replace", "--network", NETWORK, "-"], toKubeYaml(objects));
}

/** Stops and removes the objects' pods and secrets, with their volumes if asked, and Mayfly's network once nothing is left on it. */
export async function down(objects: readonly KubeObject[], { volumes = false } = {}): Promise<void> {
  await podman(["kube", "down", ...(volumes ? ["--force"] : []), "-"], toKubeYaml(objects));
  // Podman refuses while any pod still uses the network, which is what it should do.
  await run(["network", "rm", NETWORK]);
}

/** Removes a volume, if there is one by that name. */
export async function removeVolume(name: string): Promise<void> {
  if ((await run(["volume", "exists", name])).code === 0) await podman(["volume", "rm", name]);
}

async function ensureNetwork(): Promise<void> {
  const { code } = await run(["network", "exists", NETWORK]);
  if (code !== 0) await podman(["network", "create", NETWORK]);
}
