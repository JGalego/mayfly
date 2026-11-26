import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDex } from "../../src/adapters/dex/dex.ts";
import { dexIdentity } from "../../src/adapters/dex/dex-identity.ts";
import { jsonFileStore } from "../../src/adapters/json-file/json-file-store.ts";
import { down, podmanDeployer } from "../../src/adapters/podman/podman.ts";
import { createEngine } from "../../src/engine/engine.ts";
import { Browser } from "./browser.ts";
import { buildEchoImage, waitUntilUp } from "./support.ts";

const store = jsonFileStore(join(await mkdtemp(join(tmpdir(), "mayfly-")), "state.json"));
const engine = createEngine({ store, deployer: podmanDeployer, identity: dexIdentity });

after(async () => {
  for (const app of await engine.list()) await engine.remove(app.name);
  await down(await buildDex({ users: [], clients: [] }));
});

describe("the engine on Podman with Dex", () => {
  it("deploys an app the owner can sign in to, then removes it", async () => {
    const app = await engine.deploy({ name: "echo", image: buildEchoImage() });
    await waitUntilUp("http://localhost:5556/dex/healthz");
    await waitUntilUp(`${app.url}ping`);

    const owner = await engine.owner();
    const browser = new Browser();
    const page = await browser.submit(await browser.get(app.url), { login: owner.email, password: owner.password });
    assert.deepEqual(JSON.parse(page.body), { email: owner.email, groups: "owner" });

    await engine.remove("echo");
    await assert.rejects(fetch(app.url));
  });
});
