import { spawn } from "node:child_process";
import { toKubeYaml } from "../../core/kube-yaml.ts";
import type { KubeObject } from "../../core/kube.ts";

/** Every Mayfly pod joins this network, so auth proxies can reach Dex by name. */
const NETWORK = "mayfly";

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

async function podman(args: string[], input = ""): Promise<void> {
  const { code, stderr } = await run(args, input);
  if (code !== 0) throw new Error(`podman ${args.join(" ")} failed: ${stderr.trim()}`);
}

function run(args: string[], input = ""): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("podman", args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
    child.stdin.end(input);
  });
}
