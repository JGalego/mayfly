import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { proxyConfig } from "./proxy-config.ts";

const computer = proxyConfig({ listen: 4180 });
const phone = proxyConfig({ listen: 4181, loginUrl: "https://mayfly.tail1a2b.ts.net:25556/dex/auth" });

describe("a door's proxy settings", () => {
  it("drop the browser's cookies before the app sees them, by naming the header with nothing to put in it", () => {
    assert.match(computer, /^ {2}- name: Cookie\n {2}- name: /m);
  });

  it("tell the app who signed in, in headers it can't be sent from outside", () => {
    for (const [header, claim] of [["X-Forwarded-User", "user"], ["X-Forwarded-Email", "email"], ["X-Forwarded-Groups", "groups"], ["X-Forwarded-Preferred-Username", "preferred_username"]]) {
      assert.match(computer, new RegExp(`- name: ${header}\\n {4}values: \\[\\{ claimSource: \\{ claim: ${claim} \\} \\}\\]`), header);
    }
    assert.doesNotMatch(computer, /preserveRequestValue/);
  });

  it("forward to the app over the pod's loopback", () => {
    assert.match(computer, /uri: http:\/\/127\.0\.0\.1:8080\//);
  });

  it("listen on the door's own port", () => {
    assert.match(computer, /bindAddress: 0\.0\.0\.0:4180\n/);
    assert.match(phone, /bindAddress: 0\.0\.0\.0:4181\n/);
  });

  it("read the identity provider and the allowed roles from the app's ConfigMap, as the proxy fills in its environment", () => {
    for (const variable of ["OAUTH2_PROXY_OIDC_ISSUER_URL", "OAUTH2_PROXY_CLIENT_ID", "OAUTH2_PROXY_SCOPE", "OAUTH2_PROXY_SKIP_OIDC_DISCOVERY", "OAUTH2_PROXY_LOGIN_URL", "OAUTH2_PROXY_REDEEM_URL", "OAUTH2_PROXY_OIDC_JWKS_URL"]) {
      assert.ok(computer.includes(`\${${variable}}`), variable);
    }
    assert.match(computer, /allowedGroups: \[\$\{OAUTH2_PROXY_ALLOWED_GROUPS\}\]/);
  });

  it("hold no secret, only where the proxy finds it", () => {
    assert.match(computer, /clientSecret: '\$\{OAUTH2_PROXY_CLIENT_SECRET\}'/);
  });

  it("read roles from the groups claim, and ask for consent once, not at every sign-in", () => {
    assert.match(computer, /groupsClaim: groups\n/);
    assert.match(computer, /loginURLParameters: \[\{ name: approval_prompt, default: \[auto\] \}\]/);
  });

  it("send the phone to sign in on the phone's own address", () => {
    assert.match(phone, /loginURL: 'https:\/\/mayfly\.tail1a2b\.ts\.net:25556\/dex\/auth'/);
    assert.ok(!phone.includes("${OAUTH2_PROXY_LOGIN_URL}"));
  });
});
