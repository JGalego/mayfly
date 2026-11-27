import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { NO_USAGE } from "../../engine/usage.ts";
import type { ToUi } from "./messages.ts";
import { openPages } from "./pages.ts";
import { startPhoneServer, type PhoneServer, type PhoneServerPorts } from "./phone-server.ts";

const TOKEN = "phone-token";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Mobile/15E148 Safari/604.1";

const state: ToUi = {
  type: "state",
  apps: [],
  owner: "me@example.com",
  people: [],
  models: [],
  defaultModel: "openai",
  spent: NO_USAGE,
  working: null,
  developer: false,
  autostart: false,
  phoneHost: "mayfly.tail1a2b.ts.net",
  mail: null,
};

const servers: PhoneServer[] = [];
after(() => Promise.all(servers.map((server) => server.close())));

describe("the phone page's server", () => {
  it("pairs the phone that brings the code, naming it as its browser does, and gives it a token", async () => {
    const { url, paired } = await serve();

    const response = await fetch(`${url}/pair`, { method: "POST", headers: { "user-agent": IPHONE }, body: JSON.stringify({ code: "good-code" }) });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { token: TOKEN });
    assert.deepEqual(paired, ["iPhone"]);
  });

  it("says why a code doesn't work", async () => {
    const { url } = await serve();

    const response = await fetch(`${url}/pair`, { method: "POST", body: JSON.stringify({ code: "old-code" }) });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "This pairing code doesn't work. Show a new one on the computer." });
  });

  it("answers nothing else without a paired phone's token", async () => {
    const { url, handled } = await serve();

    for (const headers of [{}, { authorization: "Bearer someone-else" }, { authorization: TOKEN }]) {
      assert.equal((await fetch(`${url}/events`, { headers })).status, 401);
      assert.equal((await fetch(`${url}/messages`, { method: "POST", headers, body: JSON.stringify({ type: "health" }) })).status, 401);
    }
    assert.deepEqual(handled, []);
  });

  it("sends the state first, then what the phone may hear, one JSON message a line", async () => {
    const { url, pages } = await serve();
    const lines = await linesFrom(`${url}/events`, 2, async () => {
      await pages.post({ type: "password", password: "six-words" });
      await pages.post({ type: "created", name: "lunch" });
    });

    assert.deepEqual(lines, [{ type: "state", apps: [], working: null }, { type: "created", name: "lunch" }]);
  });

  it("stops telling a phone that's been forgotten", async () => {
    const forgotten = { paired: true };
    const { url, pages } = await serve({ phones: { pair: async () => TOKEN, paired: async () => forgotten.paired } });
    const response = await fetch(`${url}/events`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const body = response.text().then(() => "ended");

    forgotten.paired = false;
    await pages.post(state);

    assert.equal(await Promise.race([body, new Promise((resolve) => setTimeout(() => resolve("still open"), 1000))]), "ended");
  });

  it("hands the controller what the phone may ask, and refuses the rest", async () => {
    const { url, handled } = await serve();
    const post = (message: unknown) => fetch(`${url}/messages`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(message) });

    assert.equal((await post({ type: "send", app: null, request: "split lunch bills" })).status, 202);
    assert.equal((await post({ type: "show-password" })).status, 403);
    assert.equal((await post({ type: "remove", name: "lunch" })).status, 403);
    assert.equal((await post("not a message")).status, 400);
    assert.deepEqual(handled, [{ type: "send", app: null, request: "split lunch bills" }]);
  });

  it("refuses a message bigger than four photos at the most Mayfly takes", async () => {
    const { url, handled } = await serve();
    const tooBig = JSON.stringify({ type: "send", app: null, request: "x".repeat(29 * 1024 * 1024) });

    const response = await fetch(`${url}/messages`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: tooBig });

    assert.equal(response.status, 413);
    assert.deepEqual(handled, []);
  });

  it("serves the page's own files, and nothing else", async () => {
    const { url } = await serve();

    const page = await fetch(`${url}/`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(await page.text(), "<!doctype html>");
    for (const path of ["/missing.js", "/../state.json", "/%2e%2e/state.json", "/.hidden"]) assert.equal((await fetch(`${url}${path}`)).status, 404, path);
  });

  it("lets the page load nothing but itself, and be framed by no one", async () => {
    const { url } = await serve();

    const { headers } = await fetch(`${url}/`);

    assert.match(headers.get("content-security-policy") ?? "", /default-src 'self'.*frame-ancestors 'none'/);
    assert.equal(headers.get("x-content-type-options"), "nosniff");
    assert.equal(headers.get("referrer-policy"), "no-referrer");
  });

  it("listens on the next port down when the first is taken", async () => {
    const taken = createServer().listen(0, "127.0.0.1");
    await new Promise((resolve) => taken.once("listening", resolve));
    const port = (taken.address() as { port: number }).port;

    const server = await startPhoneServer(ports().ports, [port, 0]);
    servers.push(server);

    assert.notEqual(server.port, port);
    taken.close();
  });
});

function ports(overrides: Partial<PhoneServerPorts> = {}) {
  const pages = openPages();
  const handled: unknown[] = [];
  const paired: string[] = [];
  const ports: PhoneServerPorts = {
    handle: async (message) => {
      if ((message as { type: string }).type === "ready") return pages.post(state);
      handled.push(message);
    },
    pages,
    phones: {
      pair: async (code, name) => {
        if (code !== "good-code") throw new Error("This pairing code doesn't work. Show a new one on the computer.");
        paired.push(name);
        return TOKEN;
      },
      paired: async (token) => token === TOKEN,
    },
    file: async (name) => (name === "index.html" ? { type: "text/html; charset=utf-8", body: new TextEncoder().encode("<!doctype html>") } : undefined),
    ...overrides,
  };
  return { ports, pages, handled, paired };
}

async function serve(overrides: Partial<PhoneServerPorts> = {}) {
  const made = ports(overrides);
  const server = await startPhoneServer(made.ports, [0]);
  servers.push(server);
  return { ...made, url: `http://127.0.0.1:${server.port}` };
}

/** Reads the first count lines of the event stream, after the stream opens and `then` has run. */
async function linesFrom(url: string, count: number, then: () => Promise<void>): Promise<unknown[]> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${TOKEN}` } });
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let text = "";
  let ran = false;
  while (text.split("\n").length <= count) {
    const { value, done } = await reader.read();
    if (done) break;
    text += value;
    if (!ran && text.includes("\n")) {
      ran = true;
      await then();
    }
  }
  await reader.cancel();
  return text.split("\n").slice(0, count).map((line) => JSON.parse(line));
}
