import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { onPhone, phoneDoorPort, phoneSidePort } from "./phone.ts";

describe("where the phone reaches an app", () => {
  it("moves a URL to the phone's host over HTTPS, on the phone's side of its port, keeping its path", () => {
    assert.equal(onPhone("http://localhost:5556/dex/auth", "mayfly.tail1a2b.ts.net"), "https://mayfly.tail1a2b.ts.net:25556/dex/auth");
  });

  it("puts an app's phone door 10000 above its own port, on loopback", () => {
    assert.equal(phoneDoorPort(18100), 28100);
  });

  it("has the phone use ports 20000 above the computer's, which Podman never publishes", () => {
    assert.equal(phoneSidePort(18100), 38100);
    assert.equal(phoneSidePort(5556), 25556);
  });
});
