import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDex, dexSettings } from "../../src/adapters/dex/dex.ts";
import { down, play } from "../../src/adapters/podman/podman.ts";
import { appUrl, callbackUrl } from "../../src/core/app-url.ts";
import { buildAuthConfigMap } from "../../src/core/auth-config-map.ts";
import { buildAuthSecret } from "../../src/core/auth-secret.ts";
import type { KubeObject } from "../../src/core/kube.ts";
import { buildPod } from "../../src/core/pod.ts";
import { Browser } from "./browser.ts";
import { buildEchoImage, secret, waitUntilUp } from "./support.ts";

const HOST_PORT = 18137;
const APP = appUrl(HOST_PORT);

const owner = { email: "owner@mayfly.test", username: "owner", password: secret(), groups: ["owner"] };
const guest = { email: "guest@mayfly.test", username: "guest", password: secret(), groups: ["guest"] };
const client = { id: "mayfly-echo", secret: secret(), redirectUri: callbackUrl(HOST_PORT) };

let dex: KubeObject[] = [];
let app: KubeObject[] = [];

before(async () => {
  const image = buildEchoImage();
  dex = await buildDex({ users: [owner, guest], clients: [client] });
  app = [
    buildAuthConfigMap({ appName: "echo", policy: { roles: ["owner"] }, idp: dexSettings(client.id) }),
    buildAuthSecret({ appName: "echo", clientSecret: client.secret, cookieSecret: secret() }),
    buildPod({ manifest: { name: "echo", image }, hostPort: HOST_PORT }),
  ];
  await play(dex);
  await play(app);
  await waitUntilUp("http://localhost:5556/dex/healthz");
  await waitUntilUp(`${APP}ping`);
});

after(async () => {
  await down(app);
  await down(dex);
});

describe("an app behind Mayfly's sign-in, on Podman", () => {
  it("sends people who are not signed in to Dex", async () => {
    const page = await new Browser().get(APP);

    assert.match(page.url, /^http:\/\/localhost:5556\/dex\/auth\/local/);
  });

  it("lets the owner in and tells the app who they are", async () => {
    const page = await signIn(owner);

    assert.equal(page.status, 200);
    assert.deepEqual(JSON.parse(page.body), { email: owner.email, groups: "owner" });
  });

  it("turns away a signed-in user without an allowed role", async () => {
    const page = await signIn(guest);

    assert.equal(page.status, 403);
  });

  it("refuses a wrong password", async () => {
    const page = await signIn({ ...owner, password: "wrong" });

    assert.equal(page.status, 401);
  });
});

async function signIn(user: { email: string; password: string }) {
  const browser = new Browser();
  return browser.submit(await browser.get(APP), { login: user.email, password: user.password });
}
