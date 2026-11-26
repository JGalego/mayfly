import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDex } from "../../src/adapters/dex/dex.ts";
import { dexIdentity } from "../../src/adapters/dex/dex-identity.ts";
import { jsonFileStore } from "../../src/adapters/json-file/json-file-store.ts";
import { podmanBuilder } from "../../src/adapters/podman/podman-builder.ts";
import { down, podmanDeployer } from "../../src/adapters/podman/podman.ts";
import { createEngine } from "../../src/engine/engine.ts";
import type { ModelProvider } from "../../src/engine/ports.ts";
import { Browser } from "./browser.ts";
import { removeImages, replyWith, RUNTIME_IMAGE, waitUntilUp } from "./support.ts";

// A scripted model, so this test needs no API key: it always writes the hello app.
const model: ModelProvider = { complete: async () => ({ text: replyWith("hello", "hello-app"), usage: { input: 0, output: 0 } }) };
const store = jsonFileStore(join(await mkdtemp(join(tmpdir(), "mayfly-")), "state.json"));
const engine = createEngine({ store, deployer: podmanDeployer, identity: dexIdentity, model, builder: podmanBuilder(RUNTIME_IMAGE) });
const images: string[] = [];

after(async () => {
  for (const app of await engine.list()) await engine.remove(app.name);
  await down(await buildDex({ users: [], clients: [] }));
  removeImages(images);
});

describe("the engine on Podman with Dex", () => {
  it("creates an app from a description that the owner can sign in to, then removes it", async () => {
    const app = await engine.create("greet whoever signs in");
    images.push(...(await store.load()).apps.map((a) => a.manifest.image));
    await waitUntilUp("http://localhost:5556/dex/healthz");
    await waitUntilUp(`${app.url}ping`);

    const owner = await engine.owner();
    const browser = new Browser();
    const page = await browser.submit(await browser.get(app.url), { login: owner.email, password: owner.password });
    assert.match(page.body, new RegExp(`Hello, ${owner.email}`));

    await engine.remove("hello");
    await assert.rejects(fetch(app.url));
  });
});
