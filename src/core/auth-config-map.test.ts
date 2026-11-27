import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAuthConfigMap } from "./auth-config-map.ts";
import { ContractViolation } from "./contract-violation.ts";

const configMap = buildAuthConfigMap({
  appName: "expenses",
  policy: { roles: ["finance", "admin"] },
  idp: {
    OAUTH2_PROXY_OIDC_ISSUER_URL: "http://localhost:5556/dex",
    OAUTH2_PROXY_CLIENT_ID: "mayfly-expenses",
    OAUTH2_PROXY_ALLOWED_GROUPS: "everyone",
  },
});

describe("the auth ConfigMap Mayfly writes for an app", () => {
  it("is named after the app, like the Secret beside it", () => {
    assert.equal(configMap.metadata.name, "mayfly-expenses-auth");
  });

  it("carries the identity provider's proxy settings, which a recipient replaces with their own", () => {
    assert.equal(configMap.data.OAUTH2_PROXY_OIDC_ISSUER_URL, "http://localhost:5556/dex");
    assert.equal(configMap.data.OAUTH2_PROXY_CLIENT_ID, "mayfly-expenses");
  });

  it("lets in exactly the policy's roles, whatever the identity provider settings say", () => {
    assert.equal(configMap.data.OAUTH2_PROXY_ALLOWED_GROUPS, "finance,admin");
  });

  it("is never written to let everyone in", () => {
    assert.throws(() => buildAuthConfigMap({ appName: "expenses", policy: { roles: [] }, idp: {} }), ContractViolation);
  });
});
