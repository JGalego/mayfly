import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { examine, type DoctorPorts, type Examination } from "./doctor.ts";

const ready: DoctorPorts = {
  podman: async () => ({ client: "5.8.9", server: "5.8.9" }),
  runtimeReady: async () => true,
  signIn: async () => ["running"],
  models: async () => [{ id: "openai", model: "gpt-6.2-sol", hasKey: true, list: async () => ["gpt-6.2-sol", "gpt-6.2-astra"] }],
  phoneHost: async () => null,
  phoneNetwork: async () => ({ state: "missing" }),
};

const onPhone: DoctorPorts = {
  ...ready,
  phoneHost: async () => "mayfly.tail1a2b.ts.net",
  phoneNetwork: async () => ({ state: "ready", host: "mayfly.tail1a2b.ts.net" }),
};

function statuses({ ready }: Examination): string[] {
  return ready.map((check) => `${check.name}: ${check.status}`);
}

describe("the doctor", () => {
  it("passes everything when Mayfly is ready", async () => {
    const examination = await examine(ready);

    assert.deepEqual(statuses(examination), ["Podman: pass", "App runtime: pass", "Sign-in service: pass"]);
    assert.deepEqual(examination.models, [{ id: "openai", status: "pass", detail: "API key accepted. Model listed." }]);
  });

  it("says what to do when Podman is missing, its machine is off, or it is too old", async () => {
    const missing = await examine({ ...ready, podman: async () => undefined });
    const off = await examine({ ...ready, podman: async () => ({ client: "5.8.9", server: null }) });
    const old = await examine({ ...ready, podman: async () => ({ client: "4.3.1", server: "4.3.1" }) });

    assert.match(missing.ready[0]?.detail ?? "", /Set it up in Podman Desktop's Dashboard/);
    assert.match(off.ready[0]?.detail ?? "", /Start it in Podman Desktop's Dashboard/);
    assert.match(old.ready[0]?.detail ?? "", /Update to 5 or later/);
    assert.deepEqual(statuses(off), ["Podman: fail"]);
    assert.equal(off.models[0]?.status, "pass");
  });

  it("checks phone access while it's on, and only then", async () => {
    const examination = await examine(onPhone);

    assert.deepEqual(statuses(examination).at(-1), "Phone access: pass");
    assert.match(examination.ready.at(-1)?.detail ?? "", /mayfly\.tail1a2b\.ts\.net/);
  });

  it("says what to fix when Tailscale can't serve the phone, and when it has renamed the computer since", async () => {
    const noHttps = await examine({ ...onPhone, phoneNetwork: async () => ({ state: "no-https" }) });
    const renamed = await examine({ ...onPhone, phoneNetwork: async () => ({ state: "ready", host: "laptop.tail1a2b.ts.net" }) });

    assert.deepEqual(statuses(noHttps).at(-1), "Phone access: fail");
    assert.match(noHttps.ready.at(-1)?.detail ?? "", /Enable HTTPS/);
    assert.deepEqual(statuses(renamed).at(-1), "Phone access: warn");
    assert.match(renamed.ready.at(-1)?.detail ?? "", /laptop\.tail1a2b\.ts\.net.*off and on again/);
  });

  it("warns about what sorts itself out: a runtime not downloaded yet, a sign-in service not started yet", async () => {
    const examination = await examine({ ...ready, runtimeReady: async () => false, signIn: async () => [] });

    assert.deepEqual(statuses(examination).slice(1), ["App runtime: warn", "Sign-in service: warn"]);
  });

  it("tries each model, with its key or without one, and says when the provider refuses or lacks it", async () => {
    const { models } = await examine({
      ...ready,
      models: async () => [
        { id: "local", model: "m", hasKey: false, list: async () => ["m"] },
        { id: "keyed", model: "m", hasKey: true, list: async () => ["m"] },
        { id: "refused", model: "m", hasKey: true, list: async () => Promise.reject(new Error("The key was refused.")) },
        { id: "unknown", model: "m", hasKey: false, list: async () => ["other"] },
      ],
    });

    assert.deepEqual(models.map(({ id, status }) => `${id}: ${status}`), ["local: pass", "keyed: pass", "refused: fail", "unknown: warn"]);
    assert.deepEqual(
      models.map(({ detail }) => detail),
      ["Connected without an API key. Model listed.", "API key accepted. Model listed.", "The key was refused.", "Connected without an API key. The provider does not list m. Check the model name."],
    );
  });
});
