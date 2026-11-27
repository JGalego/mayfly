import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { buildApp } from "./app.ts";
import type { Env } from "./env.ts";

const signedIn = {
  "X-Forwarded-User": "u-1",
  "X-Forwarded-Email": "ana@example.com",
  "X-Forwarded-Preferred-Username": "ana",
  "X-Forwarded-Groups": "owner,finance",
};

const routes = new Hono<Env>()
  .get("/", (c) => c.json(c.get("user")))
  .post("/", async (c) => c.text(await c.req.text()))
  .get("/tailscale", (c) => c.json({ login: c.req.header("Tailscale-User-Login") ?? null, name: c.req.header("tailscale-user-name") ?? null }))
  .get("/boom", () => {
    throw new Error("database password is hunter2");
  });

const app = buildApp(routes);
let logged: string[] = [];

beforeEach(() => {
  logged = [];
  mock.method(process.stdout, "write", (line: string) => logged.push(line));
});

afterEach(() => mock.restoreAll());

describe("the runtime around a generated app", () => {
  it("answers health checks without anyone signed in", async () => {
    const response = await app.request("/healthz");

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  });

  it("refuses requests that did not come through the auth proxy", async () => {
    const response = await app.request("/");

    assert.equal(response.status, 401);
  });

  it("hides what a private network in front says about its own users, so an app knows people only from the auth proxy", async () => {
    const headers = { ...signedIn, "Tailscale-User-Login": "someone@example.com", "Tailscale-User-Name": "Someone" };

    const response = await app.request("/tailscale", { headers });

    assert.deepEqual(await response.json(), { login: null, name: null });
  });

  it("tells the app's routes who is signed in", async () => {
    const response = await app.request("/", { headers: signedIn });

    assert.deepEqual(await response.json(), {
      id: "u-1",
      email: "ana@example.com",
      name: "ana",
      groups: ["owner", "finance"],
    });
  });

  it("logs each request as one JSON line, without the query string", async () => {
    await app.request("/?token=secret", { headers: signedIn });

    const entry = JSON.parse(logged.at(-1) ?? "");
    assert.equal(entry.level, "info");
    assert.equal(entry.msg, "request");
    assert.equal(entry.method, "GET");
    assert.equal(entry.path, "/");
    assert.equal(entry.status, 200);
    assert.equal(entry.user, "ana@example.com");
    assert.ok(!logged.join("").includes("secret"));
  });

  it("logs errors and hides them from the client", async () => {
    const response = await app.request("/boom", { headers: signedIn });

    assert.equal(response.status, 500);
    assert.equal(await response.text(), "Internal Server Error");
    assert.ok(logged.some((line) => JSON.parse(line).level === "error"));
  });

  it("sends security headers, with a CSP that allows only nonce-tagged scripts", async () => {
    const response = await app.request("/", { headers: signedIn });
    const csp = response.headers.get("content-security-policy") ?? "";

    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'nonce-[^']+'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  });

  it("refuses bodies over 1 MB", async () => {
    const body = "x".repeat(1024 * 1024 + 1);
    const response = await app.request("/", { method: "POST", body, headers: signedIn });

    assert.equal(response.status, 413);
  });
});
