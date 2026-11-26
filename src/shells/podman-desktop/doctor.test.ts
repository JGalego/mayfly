import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { examine, type DoctorPorts } from "./doctor.ts";

const ready: DoctorPorts = {
  podman: async () => ({ client: "5.8.9", server: "5.8.9" }),
  runtimeReady: async () => true,
  signIn: async () => ["running"],
  models: async () => [{ label: "OpenAI · gpt-6.2-sol", model: "gpt-6.2-sol", hasKey: true, list: async () => ["gpt-6.2-sol", "gpt-6.2-astra"] }],
};

function statuses(checks: Awaited<ReturnType<typeof examine>>): string[] {
  return checks.map((check) => `${check.name}: ${check.status}`);
}

describe("the doctor", () => {
  it("passes everything when Mayfly is ready", async () => {
    assert.deepEqual(statuses(await examine(ready)), ["Podman: pass", "App runtime: pass", "Sign-in service: pass", "OpenAI · gpt-6.2-sol: pass"]);
  });

  it("says what to do when Podman is missing, its machine is off, or it is too old", async () => {
    const missing = await examine({ ...ready, podman: async () => undefined });
    const off = await examine({ ...ready, podman: async () => ({ client: "5.8.9", server: null }) });
    const old = await examine({ ...ready, podman: async () => ({ client: "4.3.1", server: "4.3.1" }) });

    assert.match(missing[0]?.detail ?? "", /cannot find Podman/);
    assert.match(off[0]?.detail ?? "", /machine does not answer/);
    assert.match(old[0]?.detail ?? "", /needs 5 or later/);
    assert.deepEqual(statuses(off), ["Podman: fail", "OpenAI · gpt-6.2-sol: pass"]);
  });

  it("warns about what sorts itself out: a runtime not downloaded yet, a sign-in service not started yet", async () => {
    const checks = await examine({ ...ready, runtimeReady: async () => false, signIn: async () => [] });

    assert.deepEqual(statuses(checks).slice(1, 3), ["App runtime: warn", "Sign-in service: warn"]);
  });

  it("tries each model's key, and says when the provider refuses it or lacks the model", async () => {
    const checks = await examine({
      ...ready,
      models: async () => [
        { label: "no key", model: "m", hasKey: false, list: async () => [] },
        { label: "refused", model: "m", hasKey: true, list: async () => Promise.reject(new Error("The key was refused.")) },
        { label: "unknown", model: "m", hasKey: true, list: async () => ["other"] },
      ],
    });

    assert.deepEqual(statuses(checks).slice(3), ["no key: warn", "refused: fail", "unknown: warn"]);
    assert.equal(checks[4]?.detail, "The key was refused.");
  });
});
