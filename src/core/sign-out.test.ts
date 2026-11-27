import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signOutTargets } from "./sign-out.ts";

const computer = { appUrl: "http://localhost:18100/", endSessionUrl: "http://localhost:5556/dex/logout" };
const phone = { appUrl: "https://mayfly.tail1a2b.ts.net:38100/", endSessionUrl: "https://mayfly.tail1a2b.ts.net:25556/dex/logout" };

describe("where signing out of an app goes", () => {
  it("is the auth proxy's sign-out, which ends the app's session", () => {
    const target = new URL(signOutTargets([computer])["localhost:18100"] ?? "", computer.appUrl);

    assert.equal(target.href.slice(0, target.href.indexOf("?")), "http://localhost:18100/.mayfly/sign_out");
  });

  it("goes on to the identity provider, which ends its own session, so no app signs them straight back in", () => {
    const next = afterProxy(signOutTargets([computer])["localhost:18100"]);

    assert.equal(`${next.origin}${next.pathname}`, "http://localhost:5556/dex/logout");
  });

  it("leaves a place for the auth proxy to put the app's ID token, so the identity provider ends the session without asking", () => {
    const next = afterProxy(signOutTargets([computer])["localhost:18100"]);

    assert.equal(next.searchParams.get("id_token_hint"), "{id_token}");
  });

  it("comes back to the app, which asks them to sign in again", () => {
    const next = afterProxy(signOutTargets([computer])["localhost:18100"]);

    assert.equal(next.searchParams.get("post_logout_redirect_uri"), "http://localhost:18100/");
  });

  it("keeps each door on its own address, by the address people opened the app at", () => {
    const targets = signOutTargets([computer, phone]);

    assert.deepEqual(Object.keys(targets), ["localhost:18100", "mayfly.tail1a2b.ts.net:38100"]);
    assert.equal(afterProxy(targets["mayfly.tail1a2b.ts.net:38100"]).origin, "https://mayfly.tail1a2b.ts.net:25556");
    assert.equal(afterProxy(targets["mayfly.tail1a2b.ts.net:38100"]).searchParams.get("post_logout_redirect_uri"), phone.appUrl);
  });
});

/** Where the auth proxy sends the browser once it has ended the app's session. */
function afterProxy(target: string | undefined): URL {
  const rd = new URL(target ?? "", "http://localhost/").searchParams.get("rd");
  assert.ok(rd, "no rd");
  return new URL(rd);
}
