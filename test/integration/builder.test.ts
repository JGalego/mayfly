import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { podmanBuilder } from "../../src/adapters/podman/podman-builder.ts";
import type { Trial } from "../../src/engine/ports.ts";
import { removeImages, RUNTIME_IMAGE } from "./support.ts";

const builder = podmanBuilder(RUNTIME_IMAGE);
const built: string[] = [];

after(() => removeImages(built));

describe("the Podman builder", () => {
  it("builds an app that passes its trial", async () => {
    const trial = await buildAndTry("good", 'import { Hono } from "hono";\nexport default new Hono().get("/", (c) => c.html(\'<h1>hi</h1><a href="/oauth2/sign_out">Sign out</a>\'));\n');

    assert.deepEqual(trial, { ok: true });
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

async function buildAndTry(name: string, routes: string): Promise<Trial> {
  const image = await builder.build(name, routes);
  built.push(image);
  return builder.trial(image);
}
