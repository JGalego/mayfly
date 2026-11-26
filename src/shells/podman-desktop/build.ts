// Builds the Podman Desktop extension into extension/ the way Podman Desktop loads it: one CommonJS
// file with every dependency inside, and the page's files in media/. Run with `npm run build:extension`.
import { build } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const out = fileURLToPath(new URL("../../../extension/", import.meta.url));

await rm(`${out}dist`, { recursive: true, force: true });
await rm(`${out}media`, { recursive: true, force: true });

await build({
  entryPoints: [`${here}extension.ts`],
  outfile: `${out}dist/extension.js`,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  // Podman Desktop provides the API module at run time.
  external: ["@podman-desktop/api"],
  // Keeps the bundled dependencies' license notices, in extension.js.LEGAL.txt.
  legalComments: "external",
});

await build({
  entryPoints: [`${here}ui/ui.ts`],
  outfile: `${out}media/ui.js`,
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
});

await mkdir(`${out}media`, { recursive: true });
for (const file of ["index.html", "ui.css"]) await copyFile(`${here}ui/${file}`, `${out}media/${file}`);
await copyFile(`${out}../LICENSE`, `${out}dist/LICENSE`);
