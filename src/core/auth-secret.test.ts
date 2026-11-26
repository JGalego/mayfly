import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAuthSecret } from "./auth-secret.ts";

describe("the auth Secret Mayfly writes for an app", () => {
  it("holds the client and cookie secrets under the app's auth name", () => {
    const secret = buildAuthSecret({ appName: "expenses", clientSecret: "c", cookieSecret: "k" });

    assert.equal(secret.metadata.name, "mayfly-expenses-auth");
    assert.deepEqual(secret.stringData, { "client-secret": "c", "cookie-secret": "k" });
  });
});
