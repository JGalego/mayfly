import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAuthConfigMap } from "./auth-config-map.ts";

const configMap = buildAuthConfigMap({
  appName: "expenses",
  policy: { roles: ["finance", "admin"] },
  idp: { issuerUrl: "http://localhost:5556/dex", clientId: "mayfly-expenses" },
});

describe("the auth ConfigMap Mayfly writes for an app", () => {
  it("is named after the app, like the Secret beside it", () => {
    assert.equal(configMap.metadata.name, "mayfly-expenses-auth");
  });

  it("holds what a recipient changes: their identity provider and the roles they let in", () => {
    assert.deepEqual(configMap.data, {
      "issuer-url": "http://localhost:5556/dex",
      "client-id": "mayfly-expenses",
      "allowed-roles": "finance,admin",
    });
  });
});
