import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

/** Builds the stand-in app on the runtime image, which `npm run build:runtime` makes. */
export function buildEchoImage(): string {
  const image = "localhost/mayfly-test-echo:1";
  execFileSync("podman", ["build", "--quiet", "--pull=never", "--tag", image, "test/fixtures/echo-app"]);
  return image;
}

/** Runs a container's liveness probe now, the way Podman does on its schedule. Throws if it fails. */
export function runHealthCheck(container: string): void {
  execFileSync("podman", ["healthcheck", "run", container]);
}

export async function waitUntilUp(url: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await fetch(url).then((response) => response.ok, () => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${url} did not come up`);
}

export function secret(): string {
  return randomBytes(16).toString("hex");
}
