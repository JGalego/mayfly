import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { podmanBuilder } from "../../src/adapters/podman/podman-builder.ts";
import { podmanData } from "../../src/adapters/podman/podman-data.ts";
import type { Trial } from "../../src/engine/ports.ts";
import { removeImages, RUNTIME_IMAGE } from "./support.ts";

const builder = podmanBuilder(RUNTIME_IMAGE);
const built: string[] = [];
const removed: string[] = [];

after(() => {
  removeImages(built);
  if (removed.length > 0) spawnSync("podman", ["volume", "rm", "--force", ...removed]);
});

describe("the Podman builder", () => {
  it("builds an app that passes its trial", async () => {
    const trial = await buildAndTry("good", 'import { Hono } from "hono";\nexport default new Hono().get("/", (c) => c.html(\'<h1>hi</h1><a href="/oauth2/sign_out">Sign out</a>\'));\n');

    assert.deepEqual(trial, { ok: true, keepsData: false });
  });

  it("reports an app that crashes as it starts, with its logs", async () => {
    const trial = await buildAndTry("crash", 'throw new Error("no config file");\n');

    assert.equal(trial.ok, false);
    assert.match(trial.ok ? "" : trial.problem, /did not start[\s\S]*no config file/);
  });

  it("reports an app without an HTML home page", async () => {
    const trial = await buildAndTry("nohome", 'import { Hono } from "hono";\nexport default new Hono().get("/other", (c) => c.text("x"));\n');

    assert.equal(trial.ok, false);
    assert.match(trial.ok ? "" : trial.problem, /GET \/ answered 404/);
  });

  it("reports an app whose home page never answers, once it has waited long enough", async () => {
    const started = Date.now();
    const trial = await buildAndTry("hangs", 'import { Hono } from "hono";\nexport default new Hono().get("/", () => new Promise(() => {}));\n');

    assert.equal(trial.ok, false);
    assert.match(trial.ok ? "" : trial.problem, /gave no answer within 10 seconds/);
    assert.ok(Date.now() - started < 60_000);
  });

  it("runs an app that keeps records on a throwaway store, and says it keeps data", async () => {
    const trial = await buildAndTry("tally", readFileSync("test/fixtures/tally-app/routes.ts", "utf8"));

    assert.deepEqual(trial, { ok: true, keepsData: true });
  });

  it("tries an app on a copy of its records, failing a version they don't fit and leaving them as they were", async () => {
    const volume = "mayfly-tallied-data";
    removed.push(volume);
    const tally = await builder.build("tallied", readFileSync("test/fixtures/tally-app/routes.ts", "utf8"));
    built.push(tally);
    keep(tally, volume, { "visit:a": { count: 1 }, "visit:b": { count: 5 } });

    const strict = await buildAndTry("tallied", readFileSync("test/fixtures/tally-strict/routes.ts", "utf8"), volume);
    const again = await builder.trial(tally, volume);

    assert.equal(strict.ok ? "" : strict.problem, "Stored records don't fit this version:\n\n- 2 `visit:` records have no `first` but this version needs it as `string`");
    assert.deepEqual(again, { ok: true, keepsData: true });
    assert.deepEqual(stored(tally, volume), { "visit:a": { count: 1 }, "visit:b": { count: 5 } });
  });

  it("copies, exports and deletes the records on a volume, and copies nothing from one that doesn't exist", async () => {
    const data = podmanData(RUNTIME_IMAGE);
    removed.push("mayfly-copied-data", "mayfly-copy-data", "mayfly-none-data");
    const tally = await builder.build("copied", readFileSync("test/fixtures/tally-app/routes.ts", "utf8"));
    built.push(tally);
    keep(tally, "mayfly-copied-data", { "visit:a": { count: 3 } });

    await data.copy("mayfly-copied-data", "mayfly-copy-data");
    await data.copy("mayfly-never-data", "mayfly-none-data");
    const exported = await data.export("mayfly-copy-data");
    await data.remove("mayfly-copied-data");

    assert.deepEqual(stored(tally, "mayfly-copy-data"), { "visit:a": { count: 3 } });
    assert.deepEqual(JSON.parse(exported), { "visit:a": { count: 3 } });
    assert.deepEqual(JSON.parse(await data.export("mayfly-none-data")), {});
    for (const volume of ["mayfly-none-data", "mayfly-copied-data"]) assert.notEqual(spawnSync("podman", ["volume", "exists", volume]).status, 0, volume);
  });

  it("tags an image by its code, so the same routes give the same image", async () => {
    const routes = 'import { Hono } from "hono";\nexport default new Hono();\n';

    const first = await builder.build("same", routes);
    built.push(first);

    assert.equal(await builder.build("same", routes), first);
  });

  it("forgets every image of an app, and only that app's", async () => {
    const kept = await builder.build("forgotten-not", 'export default 1;\n');
    built.push(kept);
    await builder.build("forgotten", 'export default 1;\n');
    await builder.build("forgotten", 'export default 2;\n');

    await builder.forget("forgotten");

    assert.deepEqual(imagesOf("forgotten"), []);
    assert.deepEqual(imagesOf("forgotten-not"), [kept]);
  });
});

function imagesOf(app: string): string[] {
  const listed = execFileSync("podman", ["images", "--filter", `reference=localhost/mayfly-app-${app}`, "--format", "{{.Repository}}:{{.Tag}}"], { encoding: "utf8" });
  return listed.split("\n").filter(Boolean);
}

async function buildAndTry(name: string, routes: string, data: string | null = null): Promise<Trial> {
  const image = await builder.build(name, routes);
  built.push(image);
  return builder.trial(image, data);
}

// Writes and reads an app's records with the runtime's own store, as the app would, in a container on the volume.
function keep(image: string, volume: string, records: Record<string, object>): void {
  const script = `import { openStore } from "/app/runtime/store.ts"; import { kindsFrom } from "/app/runtime/records.ts"; const store = openStore("/data/app.db", kindsFrom({ "visit:": { count: "number" } })); for (const [key, value] of Object.entries(${JSON.stringify(records)})) store.set(key, value);`;
  execFileSync("podman", ["run", "--rm", "--user", "65534:65534", "--volume", `${volume}:/data:U`, "--entrypoint", "/usr/bin/node", image, "--input-type=module", "--eval", script]);
}

function stored(image: string, volume: string): Record<string, object> {
  const script = `import { openStore } from "/app/runtime/store.ts"; import { kindsFrom } from "/app/runtime/records.ts"; const store = openStore("/data/app.db", kindsFrom({ "visit:": { count: "number" } })); process.stdout.write(JSON.stringify(Object.fromEntries(store.list("visit:").map((entry) => [entry.key, entry.value]))));`;
  return JSON.parse(execFileSync("podman", ["run", "--rm", "--user", "65534:65534", "--volume", `${volume}:/data:U`, "--entrypoint", "/usr/bin/node", image, "--input-type=module", "--eval", script], { encoding: "utf8" }));
}
