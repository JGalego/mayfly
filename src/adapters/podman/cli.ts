import { spawn } from "node:child_process";
import { posix, win32 } from "node:path";

// Where Podman's installers put it. A process started before Podman was installed, such as Podman Desktop
// on first run, has none of these on its PATH. Podman Desktop looks in the same places.
const INSTALL_DIRS: Partial<Record<NodeJS.Platform, readonly string[]>> = {
  win32: ["C:\\Program Files\\RedHat\\Podman"],
  darwin: ["/opt/podman/bin", "/usr/local/bin", "/opt/homebrew/bin", "/opt/local/bin"],
};

export interface Result {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs podman and reports how it went, without throwing. */
export function run(args: readonly string[], input = ""): Promise<Result> {
  return new Promise((resolve, reject) => {
    const env = withInstallDirs(process.env, process.platform);
    const child = spawn("podman", args, { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
    child.on("error", (error: NodeJS.ErrnoException) => reject(error.code === "ENOENT" ? notFound() : error));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

/** Runs podman and returns what it printed, or throws with its error. */
export async function podman(args: readonly string[], input = ""): Promise<string> {
  const { code, stdout, stderr } = await run(args, input);
  if (code !== 0) throw failure(args, stderr);
  return stdout;
}

/** Podman's error, said plainly when the person can fix it: a port on the host that another program holds. */
export function failure(args: readonly string[], stderr: string): Error {
  // Rootless Podman and the Podman machine's port forwarder both say "listen tcp <address>:<port>: bind: …".
  const port = /listen tcp\S* \S*:(\d+): bind:/.exec(stderr)?.[1];
  if (port !== undefined) return new Error(`Port ${port} on this computer is in use by another program. Stop that program, then try again.`);
  return new Error(`podman ${args.join(" ")} failed: ${stderr.trim()}`);
}

/** The environment with Podman's install folders at the end of its PATH, whatever case the platform spells PATH in. */
export function withInstallDirs(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): NodeJS.ProcessEnv {
  const dirs = INSTALL_DIRS[platform] ?? [];
  if (dirs.length === 0) return env;
  const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH") ?? "PATH";
  return { ...env, [key]: [env[key], ...dirs].filter(Boolean).join((platform === "win32" ? win32 : posix).delimiter) };
}

function notFound(): Error {
  return new Error("Mayfly could not find Podman. Set it up from Podman Desktop's Dashboard, then try again.");
}
