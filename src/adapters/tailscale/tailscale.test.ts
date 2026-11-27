import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { statusOf } from "./tailscale.ts";

const running = { BackendState: "Running", Self: { DNSName: "mayfly.tail1a2b.ts.net." }, CertDomains: ["mayfly.tail1a2b.ts.net"] };

describe("reading Tailscale's status", () => {
  it("is ready with the computer's name, without the trailing dot, once the tailnet issues it certificates", () => {
    assert.deepEqual(statusOf(running), { state: "ready", host: "mayfly.tail1a2b.ts.net" });
  });

  it("needs HTTPS when the tailnet has no certificates for the computer's name", () => {
    assert.deepEqual(statusOf({ ...running, CertDomains: null }), { state: "no-https" });
    assert.deepEqual(statusOf({ ...running, CertDomains: ["another.tail1a2b.ts.net"] }), { state: "no-https" });
  });

  it("needs someone to sign in when Tailscale asks for a login", () => {
    assert.deepEqual(statusOf({ BackendState: "NeedsLogin" }), { state: "signed-out" });
    assert.deepEqual(statusOf({ BackendState: "NeedsMachineAuth" }), { state: "signed-out" });
  });

  it("is off in any other state", () => {
    assert.deepEqual(statusOf({ BackendState: "Stopped" }), { state: "off" });
    assert.deepEqual(statusOf({}), { state: "off" });
  });
});
