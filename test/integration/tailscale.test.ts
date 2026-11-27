import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { findTailscale, tailscaleNetwork } from "../../src/adapters/tailscale/tailscale.ts";

// MAYFLY_TAILSCALE points at a CLI the finder can't see, such as Windows' from inside WSL.
const cli = process.env.MAYFLY_TAILSCALE ?? findTailscale();
const network = tailscaleNetwork(cli);
const current = await network.status();
const ready = current.state === "ready";
// Well clear of the ports Mayfly gives apps, from 18100 up, and their phone doors.
const PORT = 18990;
const TO = 28990;

after(async () => {
  if (ready) await network.stop(PORT);
});

describe("Tailscale Serve", { skip: ready ? false : `Tailscale is ${current.state}` }, () => {
  it("serves HTTPS on a port of the computer's name, forwarding to a loopback port, until stopped", async () => {
    await network.serve(PORT, TO);
    assert.equal(proxied(PORT), `http://127.0.0.1:${TO}`);

    await network.stop(PORT);
    assert.equal(proxied(PORT), undefined);
  });

  it("stops a port that isn't served without complaint", async () => {
    await network.stop(PORT);
  });
});

/** Where Serve forwards this port of the computer's name, as Tailscale reports it. */
function proxied(port: number): string | undefined {
  const served = JSON.parse(execFileSync(cli, ["serve", "status", "--json"], { encoding: "utf8" })) as {
    Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
  };
  const host = current.state === "ready" ? current.host : "";
  return served.Web?.[`${host}:${port}`]?.Handlers?.["/"]?.Proxy;
}
