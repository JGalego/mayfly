import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { phoneCreation } from "./phone-creation.ts";
import type { PhoneServer } from "./phone-server.ts";

describe("making apps from the phone", () => {
  it("serves the page, and puts it on the private network on 38099, whichever loopback port it got", async () => {
    const { creation, served, started } = setUp(18097);

    await creation.start();

    assert.deepEqual(started, [[18099, 18098, 18097, 18096, 18095, 18094, 18093, 18092, 18091, 18090]]);
    assert.deepEqual(served, [[38099, 18097]]);
  });

  it("serves one page however often it starts", async () => {
    const { creation, started } = setUp();

    await creation.start();
    await creation.start();

    assert.equal(started.length, 1);
  });

  it("takes the page off the private network, then stops serving it", async () => {
    const { creation, stopped, closed } = setUp();
    await creation.start();

    await creation.stop();

    assert.deepEqual(stopped, [38099]);
    assert.equal(closed.count, 1);
  });

  it("closes the page when Podman Desktop closes, leaving it on the private network, where the phone hears Mayfly isn't answering", async () => {
    const { creation, stopped, closed } = setUp();
    await creation.start();

    await creation.close();

    assert.deepEqual(stopped, []);
    assert.equal(closed.count, 1);
  });

  it("stops serving the page if the private network won't take it", async () => {
    const { creation, closed } = setUp(18099, new Error("Sign in to Tailscale, then try again."));

    await assert.rejects(creation.start(), /Sign in to Tailscale/);

    assert.equal(closed.count, 1);
  });
});

function setUp(port = 18099, serveFails?: Error) {
  const started: (readonly number[])[] = [];
  const served: [number, number][] = [];
  const stopped: number[] = [];
  const closed = { count: 0 };
  const creation = phoneCreation({
    startServer: async (candidates): Promise<PhoneServer> => {
      started.push(candidates);
      return { port, close: async () => void closed.count++ };
    },
    network: {
      serve: async (from, to) => {
        if (serveFails) throw serveFails;
        served.push([from, to]);
      },
      stop: async (from) => void stopped.push(from),
    },
  });
  return { creation, started, served, stopped, closed };
}
