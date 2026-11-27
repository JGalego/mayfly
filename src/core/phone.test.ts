import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { onPhone, phonePort } from "./phone.ts";

describe("where the phone reaches an app", () => {
  it("moves a URL to the phone's host over HTTPS, keeping its port and path", () => {
    assert.equal(onPhone("http://localhost:5556/dex/auth", "mayfly.tail1a2b.ts.net"), "https://mayfly.tail1a2b.ts.net:5556/dex/auth");
  });

  it("puts an app's phone door 10000 above its own port", () => {
    assert.equal(phonePort(18100), 28100);
  });
});
