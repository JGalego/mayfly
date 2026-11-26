import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { podmanBuilder } from "../../src/adapters/podman/podman-builder.ts";
import type { Trial } from "../../src/engine/ports.ts";
import { removeImages, RUNTIME_IMAGE } from "./support.ts";

const builder = podmanBuilder(RUNTIME_IMAGE);
const built: string[] = [];

after(() => removeImages(built));

describe("the Podman builder", () => {
  it("builds an app that passes its trial", async () => {
    const trial = await buildAndTry("good", 'import { Hono } from "hono";\nexport default new Hono().get("/", (c) => c.html("<h1>hi</h1>"));\n');

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

  it("tags an image by its code, so the same routes give the same image", async () => {
    const routes = 'import { Hono } from "hono";\nexport default new Hono();\n';

    const first = await builder.build("same", routes);
    built.push(first);

    assert.equal(await builder.build("same", routes), first);
  });
});

async function buildAndTry(name: string, routes: string): Promise<Trial> {
  const image = await builder.build(name, routes);
  built.push(image);
  return builder.trial(image);
}
