import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { App } from "../../engine/state.ts";
import { NO_USAGE } from "../../engine/usage.ts";
import { clientFor, sessionKeyFor } from "./dex-identity.ts";

const app: App = { name: "lunch", hostPort: 18100, clientSecret: "secret", cookieSecret: "cookie", model: null, starred: false, versions: [], head: null, conversation: [], spent: NO_USAGE };

describe("each app's sign-in client", () => {
  it("sends people back to the app's localhost door, after they sign in and after they sign out", () => {
    assert.deepEqual(clientFor(app, null), {
      id: "mayfly-lunch",
      secret: "secret",
      redirectUris: ["http://localhost:18100/.mayfly/callback"],
      postLogoutRedirectUris: ["http://localhost:18100/"],
    });
  });

  it("sends the phone back to the app's phone door too, while phone access is on", () => {
    const client = clientFor(app, "mayfly.tail1a2b.ts.net");

    assert.deepEqual(client.redirectUris, ["http://localhost:18100/.mayfly/callback", "https://mayfly.tail1a2b.ts.net:38100/.mayfly/callback"]);
    assert.deepEqual(client.postLogoutRedirectUris, ["http://localhost:18100/", "https://mayfly.tail1a2b.ts.net:38100/"]);
  });
});

describe("the sign-in session key", () => {
  const owner = { email: "me@mayfly.local", username: "me", password: "thank-machine-dreamless-unease-landless-reverence" };

  it("is 32 characters, the same for the same password, so sessions survive Dex starting again", () => {
    const key = sessionKeyFor(owner);

    assert.equal(key?.length, 32);
    assert.equal(sessionKeyFor({ ...owner }), key);
  });

  it("changes with the password, so a new password signs every device out", () => {
    assert.notEqual(sessionKeyFor({ ...owner, password: "another-six-words-for-the-owner" }), sessionKeyFor(owner));
  });

  it("is none without an owner, who is the only one who signs in", () => {
    assert.equal(sessionKeyFor(null), undefined);
  });
});
