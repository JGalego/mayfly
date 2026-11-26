import { spawn } from "node:child_process";

export interface Result {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs podman and reports how it went, without throwing. */
export function run(args: readonly string[], input = ""): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn("podman", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

/** Runs podman and returns what it printed, or throws with its error. */
export async function podman(args: readonly string[], input = ""): Promise<string> {
  const { code, stdout, stderr } = await run(args, input);
  if (code !== 0) throw new Error(`podman ${args.join(" ")} failed: ${stderr.trim()}`);
  return stdout;
}
