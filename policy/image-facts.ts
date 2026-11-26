// Collects what policy/image.rego checks: the image config, its size, and every file with its mode and owner.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface FileFact {
  readonly path: string;
  readonly mode: number;
  readonly uid: number;
  readonly gid: number;
  readonly type: string;
}

const TYPES: Readonly<Record<string, string>> = { "-": "file", d: "directory", l: "symlink", h: "hardlink" };

const image = process.argv[2];
if (image === undefined) throw new Error("usage: image-facts.ts <image>");
const [inspected] = JSON.parse(podman("image", "inspect", image)) as { Config: object; Size: number }[];
process.stdout.write(JSON.stringify({ config: inspected?.Config, size: inspected?.Size, files: listFiles(image) }));

function listFiles(image: string): FileFact[] {
  const dir = mkdtempSync(join(tmpdir(), "mayfly-facts-"));
  const container = podman("create", image).trim();
  try {
    podman("export", "--output", join(dir, "fs.tar"), container);
    const listing = execFileSync("tar", ["--numeric-owner", "-tvf", join(dir, "fs.tar")], { encoding: "utf8" });
    return listing.split("\n").filter(Boolean).map(parseEntry);
  } finally {
    podman("rm", container);
    rmSync(dir, { recursive: true });
  }
}

// One line of `tar -tv`: "drwxr-xr-x 0/0  0 1970-01-01 00:00 app/runtime/".
function parseEntry(line: string): FileFact {
  const match = /^(\S{10})\s+(\d+)\/(\d+)\s+\d+\s+\S+\s+\S+\s+(.+)$/.exec(line);
  if (match === null) throw new Error(`unexpected tar line: ${line}`);
  const [, permissions = "", uid, gid, name = ""] = match;
  return { path: pathOf(name), mode: modeOf(permissions), uid: Number(uid), gid: Number(gid), type: TYPES[permissions[0] ?? ""] ?? "other" };
}

function pathOf(name: string): string {
  return name.replace(/ (->|link to) .*$/, "").replace(/^\.\//, "").replace(/\/$/, "");
}

// "-rwsr-xr-t" to its numeric mode. An uppercase S or T means the special bit without execute.
function modeOf(permissions: string): number {
  const bits = [0o400, 0o200, 0o100, 0o40, 0o20, 0o10, 0o4, 0o2, 0o1];
  let mode = bits.reduce((sum, bit, i) => ("-ST".includes(permissions[i + 1] ?? "-") ? sum : sum | bit), 0);
  if ("sS".includes(permissions[3] ?? "-")) mode |= 0o4000;
  if ("sS".includes(permissions[6] ?? "-")) mode |= 0o2000;
  if ("tT".includes(permissions[9] ?? "-")) mode |= 0o1000;
  return mode;
}

function podman(...args: string[]): string {
  return execFileSync("podman", args, { encoding: "utf8" });
}
