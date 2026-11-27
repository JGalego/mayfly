import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { onPhone, phonePort } from "./phone.ts";

describe("where the phone reaches an app", () => {
  it("moves a URL to the phone's address, keeping its port and path, over HTTPS", () => {
    const url = onPhone("http://localhost:5556/dex/auth", { host: "mayfly.tail1a2b.ts.net", scheme: "https" });

    assert.equal(url, "https://mayfly.tail1a2b.ts.net:5556/dex/auth");
  });

  it("keeps plain HTTP in the HTTP mode", () => {
    const url = onPhone("http://localhost:18100/oauth2/callback", { host: "mayfly.tail1a2b.ts.net", scheme: "http" });

    assert.equal(url, "http://mayfly.tail1a2b.ts.net:18100/oauth2/callback");
  });

  it("puts an app's phone door 10000 above its own port", () => {
    assert.equal(phonePort(18100), 28100);
  });
});
