import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { examine, type DoctorPorts, type Examination } from "./doctor.ts";

const ready: DoctorPorts = {
  podman: async () => ({ client: "5.8.9", server: "5.8.9" }),
  runtimeReady: async () => true,
  signIn: async () => ["running"],
  models: async () => [{ id: "openai", model: "gpt-6.2-sol", hasKey: true, list: async () => ["gpt-6.2-sol", "gpt-6.2-astra"] }],
};

function statuses({ ready }: Examination): string[] {
  return ready.map((check) => `${check.name}: ${check.status}`);
}

describe("the doctor", () => {
  it("passes everything when Mayfly is ready", async () => {
    const examination = await examine(ready);

    assert.deepEqual(statuses(examination), ["Podman: pass", "App runtime: pass", "Sign-in service: pass"]);
    assert.deepEqual(examination.models, [{ id: "openai", status: "pass", detail: "The provider accepts the key and has this model." }]);
  });

  it("says what to do when Podman is missing, its machine is off, or it is too old", async () => {
    const missing = await examine({ ...ready, podman: async () => undefined });
    const off = await examine({ ...ready, podman: async () => ({ client: "5.8.9", server: null }) });
    const old = await examine({ ...ready, podman: async () => ({ client: "4.3.1", server: "4.3.1" }) });

    assert.match(missing.ready[0]?.detail ?? "", /cannot find Podman/);
    assert.match(off.ready[0]?.detail ?? "", /machine does not answer/);
    assert.match(old.ready[0]?.detail ?? "", /needs 5 or later/);
    assert.deepEqual(statuses(off), ["Podman: fail"]);
    assert.equal(off.models[0]?.status, "pass");
  });

  it("warns about what sorts itself out: a runtime not downloaded yet, a sign-in service not started yet", async () => {
    const examination = await examine({ ...ready, runtimeReady: async () => false, signIn: async () => [] });

    assert.deepEqual(statuses(examination).slice(1), ["App runtime: warn", "Sign-in service: warn"]);
  });

  it("tries each model's key, says when the provider refuses it or lacks the model, and leaves models with no key alone", async () => {
    const { models } = await examine({
      ...ready,
      models: async () => [
        { id: "no key", model: "m", hasKey: false, list: async () => [] },
        { id: "refused", model: "m", hasKey: true, list: async () => Promise.reject(new Error("The key was refused.")) },
        { id: "unknown", model: "m", hasKey: true, list: async () => ["other"] },
      ],
    });

    assert.deepEqual(models.map(({ id, status }) => `${id}: ${status}`), ["refused: fail", "unknown: warn"]);
    assert.equal(models[0]?.detail, "The key was refused.");
  });
});
