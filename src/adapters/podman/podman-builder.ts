import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { APP_PORT, HEALTH_CHECK, NODE } from "../../core/contract.ts";
import { homePageProblem, type HomePage } from "../../core/home-page.ts";
import type { Builder, Trial } from "../../engine/ports.ts";
import { podman, run } from "./cli.ts";

const STARTUP_TIMEOUT_MS = 15_000;
const POLL_MS = 500;

// The trial runs the model's code before anyone has looked at it: no network, nothing writable, no privileges.
const SANDBOX = [
  "--network", "none",
  "--read-only",
  "--user", "65534:65534",
  "--cap-drop", "ALL",
  "--security-opt", "no-new-privileges",
  "--memory", "256m",
  "--pids-limit", "128",
];

// Who the trial says is signed in, the way the auth proxy would.
const TRIAL_USER = { "x-forwarded-user": "trial", "x-forwarded-email": "trial@mayfly.local", "x-forwarded-groups": "owner" };

/** Builds app images on the runtime image and tries them out, on local Podman. */
export function podmanBuilder(runtimeImage: string): Builder {
  return { build: (name, routes) => build(runtimeImage, name, routes), trial, forget };
}

/** Where an app's images go, one tag per version's code. */
function repository(name: string): string {
  return `localhost/mayfly-app-${name}`;
}

async function build(runtimeImage: string, name: string, routes: string): Promise<string> {
  // Tagged by its code, so the same routes always give the same image.
  const image = `${repository(name)}:${createHash("sha256").update(routes).digest("hex").slice(0, 12)}`;
  const context = await mkdtemp(join(tmpdir(), "mayfly-build-"));
  try {
    await writeFile(join(context, "Containerfile"), `FROM ${runtimeImage}\nCOPY routes.ts /app/routes.ts\n`);
    await writeFile(join(context, "routes.ts"), routes);
    // Readable by the app's user whatever the umask; COPY keeps the mode and makes root the owner.
    await chmod(join(context, "routes.ts"), 0o644);
    await podman(["build", "--quiet", "--pull=missing", "--source-date-epoch", "0", "--rewrite-timestamp", "--tag", image, context]);
    return image;
  } finally {
    await rm(context, { recursive: true, force: true });
  }
}

async function forget(name: string): Promise<void> {
  const listed = await podman(["images", "--filter", `reference=${repository(name)}`, "--format", "{{.Repository}}:{{.Tag}}"]);
  // Another app built from the same code shares the image, and the listing gives its names too: those stay.
  const images = listed.split("\n").filter((image) => image.startsWith(`${repository(name)}:`));
  // An image Podman will not remove, say one a container still uses, is left: it costs little, and it stops nothing.
  if (images.length > 0) await run(["rmi", ...images]);
}

async function trial(image: string): Promise<Trial> {
  const container = `mayfly-trial-${randomUUID().slice(0, 8)}`;
  await podman(["run", "--detach", "--name", container, ...SANDBOX, "--env", `PORT=${APP_PORT}`, image]);
  try {
    return await visit(container);
  } finally {
    await run(["rm", "--force", "--time", "0", container]);
  }
}

async function visit(container: string): Promise<Trial> {
  if (!(await becomesHealthy(container))) return failure(container, "It did not start: its health check never passed.");
  const problem = homePageProblem(await requestHome(container));
  return problem === null ? { ok: true } : failure(container, problem);
}

async function becomesHealthy(container: string): Promise<boolean> {
  for (let waited = 0; waited < STARTUP_TIMEOUT_MS; waited += POLL_MS) {
    if ((await run(["exec", container, ...HEALTH_CHECK])).code === 0) return true;
    if (!(await isRunning(container))) return false;
    await sleep(POLL_MS);
  }
  return false;
}

async function isRunning(container: string): Promise<boolean> {
  return (await podman(["inspect", "--format", "{{.State.Running}}", container])).trim() === "true";
}

// Visits the home page from inside the container, since the trial has no network to reach it from outside.
async function requestHome(container: string): Promise<HomePage> {
  const headers = JSON.stringify(TRIAL_USER);
  const script = `fetch("http://127.0.0.1:${APP_PORT}/", { headers: ${headers} }).then(async (r) => process.stdout.write(JSON.stringify({ status: r.status, type: r.headers.get("content-type") ?? "", body: await r.text() })))`;
  const { code, stdout } = await run(["exec", container, NODE, "--eval", script]);
  return code === 0 ? (JSON.parse(stdout) as HomePage) : { status: 0, type: "", body: "" };
}

async function failure(container: string, reason: string): Promise<Trial> {
  const { stdout, stderr } = await run(["logs", "--tail", "40", container]);
  return { ok: false, problem: `${reason}\n\nIts logs:\n${`${stdout}${stderr}`.trim() || "(none)"}` };
}
