import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lineSplitter, openLink, pair, waitBefore, type LinkPorts, type LinkStatus } from "./link.ts";

describe("the phone's link to the computer", () => {
  it("pairs with the code it was given, keeping the token it gets back", async () => {
    const { ports, kept, sent } = fakes(() => Response.json({ token: "phone-token" }));

    await pair("good-code", ports);

    assert.equal(kept.get("mayfly.phone"), "phone-token");
    assert.deepEqual(sent, [{ url: "/pair", body: '{"code":"good-code"}', authorization: null }]);
  });

  it("says why a code doesn't work", async () => {
    const { ports } = fakes(() => Response.json({ error: "This pairing code doesn't work. Show a new one on the computer." }, { status: 403 }));

    await assert.rejects(pair("old-code", ports), /Show a new one on the computer/);
  });

  it("hears each line as a message, whole, however the stream breaks it up", () => {
    const heard: string[] = [];
    const split = lineSplitter((line) => heard.push(line));

    split('{"type":"crea');
    split('ted","name":"lunch"}\n{"type":"notice","text":"hi"}\n{"ty');

    assert.deepEqual(heard, ['{"type":"created","name":"lunch"}', '{"type":"notice","text":"hi"}']);
  });

  it("waits longer each time it can't reach the computer, up to 15 seconds", () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5].map(waitBefore), [1000, 2000, 4000, 8000, 15000, 15000]);
  });

  it("follows the computer's messages once paired, saying it's online", async () => {
    const { ports } = fakes(() => new Response('{"type":"created","name":"lunch"}\n'), "phone-token");
    const heard: unknown[] = [];
    const statuses: LinkStatus[] = [];

    openLink(ports, (message) => heard.push(message), (status) => statuses.push(status));
    await until(() => heard.length === 1);

    assert.deepEqual(heard, [{ type: "created", name: "lunch" }]);
    assert.deepEqual(statuses.slice(0, 2), ["connecting", "online"]);
  });

  it("forgets its token once the computer no longer knows it", async () => {
    const { ports, kept } = fakes(() => new Response(null, { status: 401 }), "forgotten-token");
    const statuses: LinkStatus[] = [];

    openLink(ports, () => {}, (status) => statuses.push(status));
    await until(() => statuses.includes("unpaired"));

    assert.equal(kept.get("mayfly.phone"), undefined);
  });

  it("sends a message with its token, and says why the computer didn't take it", async () => {
    const replies = [new Response(null, { status: 202 }), new Response(null, { status: 403 })];
    const { ports, sent } = fakes((url) => (url === "/messages" ? (replies.shift() as Response) : new Response("")), "phone-token");
    const link = openLink(ports, () => {}, () => {});

    await link.send({ type: "health" });
    await assert.rejects(link.send({ type: "health" }), /on the computer/);

    assert.deepEqual(sent.filter((request) => request.url === "/messages")[0], { url: "/messages", body: '{"type":"health"}', authorization: "Bearer phone-token" });
  });
});

function fakes(reply: (url: string) => Response, token?: string) {
  const kept = new Map<string, string>(token === undefined ? [] : [["mayfly.phone", token]]);
  const sent: { url: string; body: string | null; authorization: string | null }[] = [];
  let streams = 0;
  const ports: LinkPorts = {
    fetch: async (input, init) => {
      const url = String(input);
      sent.push({ url, body: (init?.body as string | undefined) ?? null, authorization: new Headers(init?.headers).get("authorization") });
      // Connecting again never answers, as when the computer sleeps, so each test's link winds down.
      if (url === "/events" && ++streams > 1) return new Promise<Response>(() => {});
      return reply(url);
    },
    storage: {
      getItem: (key) => kept.get(key) ?? null,
      setItem: (key, value) => void kept.set(key, value),
      removeItem: (key) => void kept.delete(key),
    },
  };
  return { ports, kept, sent };
}

async function until(done: () => boolean): Promise<void> {
  for (let tries = 0; tries < 100 && !done(); tries++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(done(), "never happened");
}
