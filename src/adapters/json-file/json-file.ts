import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** What a JSON file holds, or undefined when there is no file yet. */
export async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Writes a JSON file that only its owner can read. */
export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // Written aside and renamed into place, so a crash never leaves half a file.
  const partial = `${path}.partial`;
  await writeFile(partial, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(partial, path);
}
