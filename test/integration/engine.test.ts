import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDex } from "../../src/adapters/dex/dex.ts";
import { dexIdentity } from "../../src/adapters/dex/dex-identity.ts";
import { jsonFileStore } from "../../src/adapters/json-file/json-file-store.ts";
import { fileStore } from "../../src/adapters/files/file-store.ts";
import { podmanBuilder } from "../../src/adapters/podman/podman-builder.ts";
import { down, podmanDeployer, podmanObserver } from "../../src/adapters/podman/podman.ts";
import { createEngine } from "../../src/engine/engine.ts";
import type { ModelProvider, PhoneNetwork } from "../../src/engine/ports.ts";
import { Browser } from "./browser.ts";
import { removeImages, replyWith, RUNTIME_IMAGE, waitUntilUp } from "./support.ts";

// A scripted model, so this test needs no API key: it always writes the hello app.
const model: ModelProvider = { name: "a scripted model", provider: "a script", complete: async () => ({ text: replyWith("hello", "hello-app"), thinking: "", usage: { input: 0, output: 0, thinking: 0 } }) };
const folder = await mkdtemp(join(tmpdir(), "mayfly-"));
const store = jsonFileStore(join(folder, "state.json"));
// Phone access stays off here: Tailscale's own test covers serving.
const phoneNetwork: PhoneNetwork = { status: async () => ({ state: "missing" }), serve: async () => {}, stop: async () => {} };
const engine = createEngine({ store, deployer: podmanDeployer, observer: podmanObserver, identity: dexIdentity(), models: () => model, builder: podmanBuilder(RUNTIME_IMAGE), files: fileStore(join(folder, "files")), phoneNetwork });
const images: string[] = [];

after(async () => {
  for (const app of await engine.list()) await engine.remove(app.name);
  await down(await buildDex({ users: [], clients: [] }));
  removeImages(images);
});

describe("the engine on Podman with Dex", () => {
  it("creates an app from a description that the owner can sign in to, then removes it", async () => {
    const app = await engine.create("greet whoever signs in");
    images.push(...(await store.load()).apps.flatMap((a) => a.versions.flatMap((v) => v.image ?? [])));
    await waitUntilUp("http://localhost:5556/dex/healthz");
    await waitUntilUp(`${app.url}ping`);

    const owner = await engine.owner();
    const browser = new Browser();
    const page = await browser.submit(await browser.get(app.url), { login: owner.email, password: owner.password });
    assert.match(page.body, new RegExp(`Hello, ${owner.email}`));
    const health = await engine.health();
    assert.deepEqual(health.find((service) => service.name === "hello")?.containers.map((c) => [c.name, c.state]).sort(), [
      ["app", "running"],
      ["auth-proxy", "running"],
    ]);
    assert.ok((await engine.logs("mayfly-hello", "app")).some((line) => line.includes('"level":"info"')));

    await engine.remove("hello");
    await assert.rejects(fetch(app.url));
    // The last app took sign-in and Mayfly's network with it.
    await assert.rejects(fetch("http://localhost:5556/dex/healthz"));
    assert.notEqual(spawnSync("podman", ["network", "exists", "mayfly"]).status, 0);
  });
});
