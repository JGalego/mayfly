// Builds the Podman Desktop extension into extension/ the way Podman Desktop loads it: one CommonJS
// file with every dependency inside, and the page's files in media/. Run with `npm run build:extension`.
import { build, type Metafile } from "esbuild";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../../", import.meta.url));
const out = `${root}extension/`;

await rm(`${out}dist`, { recursive: true, force: true });
await rm(`${out}media`, { recursive: true, force: true });

const extension = await build({
  entryPoints: [`${here}extension.ts`],
  outfile: `${out}dist/extension.js`,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  // Podman Desktop provides the API module at run time.
  external: ["@podman-desktop/api"],
  metafile: true,
});

const page = await build({
  entryPoints: [`${here}ui/ui.ts`],
  outfile: `${out}media/ui.js`,
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  metafile: true,
});

await mkdir(`${out}media`, { recursive: true });
for (const file of ["index.html", "ui.css"]) await copyFile(`${here}ui/${file}`, `${out}media/${file}`);
await copyFile(`${root}assets/logo.svg`, `${out}media/logo.svg`);
await copyFile(`${root}LICENSE`, `${out}dist/LICENSE`);
await writeFile(`${out}dist/THIRD-PARTY-NOTICES.txt`, await notices([extension.metafile, page.metafile]));

/** The licence of every package bundled in, since their licences ask for it to ship with their code. */
async function notices(metafiles: readonly Metafile[]): Promise<string> {
  const packages = new Set<string>();
  for (const { inputs } of metafiles) {
    for (const input of Object.keys(inputs)) {
      const name = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input)?.[1];
      if (name !== undefined) packages.add(name);
    }
  }
  const texts = [];
  for (const name of [...packages].sort()) {
    const folder = `${root}node_modules/${name}`;
    const file = (await readdir(folder)).find((entry) => /^licen[cs]e/i.test(entry));
    if (file === undefined) throw new Error(`${name} is bundled in but has no licence file to ship with it`);
    texts.push(`${name}\n\n${(await readFile(`${folder}/${file}`, "utf8")).trim()}`);
  }
  return `${texts.join("\n\n---\n\n")}\n`;
}
