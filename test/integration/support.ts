import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

/** Builds the stand-in app and returns its image. */
export function buildEchoImage(): string {
  const image = "localhost/mayfly-test-echo:latest";
  execFileSync("podman", ["build", "--quiet", "--tag", image, "test/fixtures/echo-app"]);
  return image;
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
