import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { App } from "../../engine/state.ts";
import { NO_USAGE } from "../../engine/usage.ts";
import { clientFor } from "./dex-identity.ts";

const app: App = { name: "lunch", hostPort: 18100, clientSecret: "secret", cookieSecret: "cookie", model: null, starred: false, versions: [], head: null, conversation: [], spent: NO_USAGE };

describe("each app's sign-in client", () => {
  it("sends people back to the app's localhost door", () => {
    assert.deepEqual(clientFor(app, null), { id: "mayfly-lunch", secret: "secret", redirectUris: ["http://localhost:18100/oauth2/callback"] });
  });

  it("sends the phone back to the app's phone door too, while phone access is on", () => {
    assert.deepEqual(clientFor(app, "mayfly.tail1a2b.ts.net").redirectUris, [
      "http://localhost:18100/oauth2/callback",
      "https://mayfly.tail1a2b.ts.net:38100/oauth2/callback",
    ]);
  });
});
