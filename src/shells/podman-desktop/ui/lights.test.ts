import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AppView, ServiceHealth } from "../../../engine/engine.ts";
import { lightFor } from "./lights.ts";

const app: AppView = { name: "lunch", url: "http://localhost:18100/", model: null, starred: false, head: "v1", versions: [], conversation: [], spent: { input: 0, output: 0, thinking: 0 }, people: [], keepsData: false, backups: [] };

function healthWith(...containers: { state: string; restarts: number; health?: "starting" | "healthy" | "unhealthy" }[]): ServiceHealth[] {
  return [{ name: "lunch", kind: "app", pod: "mayfly-lunch", containers: containers.map((container, index) => ({ name: `c${index}`, status: "", ...container })) }];
}

describe("an app's light", () => {
  it("is green when every container runs, yellow when one has restarted, red when one has stopped or none run", () => {
    assert.equal(lightFor(app, healthWith({ state: "running", restarts: 0 }), null).colour, "green");
    assert.equal(lightFor(app, healthWith({ state: "running", restarts: 2 }), null).colour, "yellow");
    assert.equal(lightFor(app, healthWith({ state: "running", restarts: 0 }, { state: "exited", restarts: 0 }), null).colour, "red");
    assert.equal(lightFor(app, [], null).colour, "red");
  });

  it("is a green ring while the app starts, and a red ring while it fails its health check, whatever it did before", () => {
    assert.equal(lightFor(app, healthWith({ state: "running", restarts: 0, health: "starting" }, { state: "running", restarts: 0 }), null).colour, "starting");
    assert.equal(lightFor(app, healthWith({ state: "running", restarts: 3, health: "starting" }), null).colour, "starting");
    assert.equal(lightFor(app, healthWith({ state: "running", restarts: 1, health: "unhealthy" }), null).colour, "unhealthy");
    assert.equal(lightFor(app, healthWith({ state: "running", restarts: 1, health: "healthy" }), null).colour, "yellow");
    assert.equal(lightFor(app, healthWith({ state: "exited", restarts: 0, health: "unhealthy" }), null).colour, "red");
  });

  it("is orange while Mayfly works on the app, whatever Podman says", () => {
    assert.equal(lightFor(app, healthWith({ state: "exited", restarts: 0 }), "lunch").colour, "orange");
  });

  it("is grey for an app that has never run, and unknown before Podman has answered", () => {
    assert.equal(lightFor({ ...app, head: null }, [], null).colour, "grey");
    assert.equal(lightFor(app, undefined, null).colour, "unknown");
  });

  it("says in words what it means", () => {
    assert.equal(lightFor(app, healthWith({ state: "running", restarts: 1 }), null).meaning, "Running after 1 restart");
  });
});
