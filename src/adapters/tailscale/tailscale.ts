import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import type { PhoneNetwork, PhoneNetworkStatus } from "../../engine/ports.ts";

// Where Tailscale's installers put its CLI. On macOS it ships inside the app, or as a command the app installs.
const INSTALLED: Partial<Record<NodeJS.Platform, readonly string[]>> = {
  win32: ["C:\\Program Files\\Tailscale\\tailscale.exe"],
  darwin: ["/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/usr/local/bin/tailscale", "/opt/homebrew/bin/tailscale"],
};

// The CLI waits for someone to act in a browser when the tailnet lacks a feature it needs. Mayfly doesn't wait that long.
const TIMEOUT_MS = 30_000;

/** The fields of `tailscale status --json` Mayfly reads. Tailscale warns its format may change, so nothing else is relied on. */
export interface TailscaleStatus {
  readonly BackendState?: string;
  readonly Self?: { readonly DNSName?: string };
  readonly CertDomains?: readonly string[] | null;
}

/** Tailscale Serve, through its CLI. */
export function tailscaleNetwork(cli = findTailscale()): PhoneNetwork {
  return {
    status: () => status(cli),
    serve: (port, to) => serve(cli, port, to),
    stop: (port) => stop(cli, port),
  };
}

/** Whether the phone can reach the computer, from what Tailscale reports. */
export function statusOf({ BackendState, Self, CertDomains }: TailscaleStatus): PhoneNetworkStatus {
  if (BackendState === "NeedsLogin" || BackendState === "NeedsMachineAuth") return { state: "signed-out" };
  if (BackendState !== "Running") return { state: "off" };
  const host = (Self?.DNSName ?? "").replace(/\.$/, "");
  return host !== "" && (CertDomains ?? []).includes(host) ? { state: "ready", host } : { state: "no-https" };
}

/** Where Tailscale's CLI is: where its installer puts it, or else on the PATH. */
export function findTailscale(): string {
  return (INSTALLED[process.platform] ?? []).find(isExecutable) ?? "tailscale";
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function status(cli: string): Promise<PhoneNetworkStatus> {
  const result = await run(cli, ["status", "--json"]);
  if (result === "missing") return { state: "missing" };
  // The CLI fails when Tailscale itself isn't running. Warnings, such as a version mismatch, go to stderr.
  return result.code === 0 ? statusOf(JSON.parse(result.stdout) as TailscaleStatus) : { state: "off" };
}

async function serve(cli: string, port: number, to: number): Promise<void> {
  const result = await run(cli, ["serve", "--bg", `--https=${port}`, `http://127.0.0.1:${to}`]);
  if (result === "missing" || result.code !== 0) throw failure(result, `serve port ${port}`);
}

async function stop(cli: string, port: number): Promise<void> {
  const result = await run(cli, ["serve", `--https=${port}`, "off"]);
  if (result !== "missing" && (result.code === 0 || /handler does not exist/.test(said(result)))) return;
  throw failure(result, `stop serving port ${port}`);
}

/** What went wrong, said plainly where the person can fix it. */
function failure(result: Result | "missing", doing: string): Error {
  if (result === "missing") return new Error("Mayfly could not find Tailscale. Install it from tailscale.com/download and sign in.");
  // On Linux, only root or the operator Tailscale names may change what it serves.
  if (/access denied/i.test(said(result))) return new Error("Tailscale refused. Let your user manage it with `sudo tailscale set --operator=$USER`, then try again.");
  if (result.code === null) return new Error(`Tailscale did not ${doing} within ${TIMEOUT_MS / 1000} seconds. If it asked to enable a feature for the tailnet, enable it, then try again.`);
  return new Error(`Tailscale could not ${doing}: ${said(result).trim()}`);
}

interface Result {
  /** null when Mayfly stopped waiting. */
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Everything the CLI printed. */
function said({ stdout, stderr }: Result): string {
  return `${stdout}${stderr}`;
}

/** Runs the CLI with a time limit, or says it isn't there. */
function run(cli: string, args: readonly string[]): Promise<Result | "missing"> {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      // EACCES too: the PATH search found only something it can't run, such as a folder named Tailscale.
      if (error.code === "ENOENT" || error.code === "EACCES") resolve("missing");
      else reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code: signal === null ? code : null, stdout, stderr });
    });
  });
}
