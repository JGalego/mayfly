import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AppView } from "../../engine/engine.ts";
import { NO_USAGE } from "../../engine/usage.ts";
import type { FromUi, ToUi } from "./messages.ts";
import { forPhone, phoneMayAsk } from "./phone-page.ts";

const lunch: AppView = {
  name: "lunch",
  url: "http://localhost:18100/",
  model: null,
  starred: true,
  head: "1a2b3c4d",
  versions: [],
  conversation: [{ from: "person", text: "split lunch bills", at: 1 }],
  spent: NO_USAGE,
  people: ["ana@example.com"],
  keepsData: false,
  backups: [],
};

const state: ToUi = {
  type: "state",
  apps: [lunch],
  owner: "me@example.com",
  people: ["ana@example.com"],
  models: [],
  defaultModel: "openai",
  spent: NO_USAGE,
  working: null,
  developer: true,
  autostart: false,
  phoneHost: "mayfly.tail1a2b.ts.net",
  mail: { host: "smtp.example.com", port: 465, username: "me@example.com", from: "me@example.com" },
  phoneCreation: true,
  phones: [{ id: "a1b2c3d4", name: "Ana's iPhone", pairedAt: 1 }],
};

describe("what the phone may ask", () => {
  it("to make, change and start apps, and follow along", () => {
    const asks: FromUi[] = [
      { type: "ready" },
      { type: "send", app: null, request: "split lunch bills" },
      { type: "ask", app: "lunch", question: "who owes most?" },
      { type: "fix", app: "lunch" },
      { type: "retry", app: "lunch" },
      { type: "undo", app: "lunch" },
      { type: "start", app: "lunch" },
      { type: "attachment", app: "lunch", id: "f00d" },
      { type: "health" },
    ];

    assert.deepEqual(asks.filter((message) => !phoneMayAsk(message)), []);
  });

  it("never to see a secret, change a setting, or take anything away", () => {
    const refused: FromUi[] = [
      { type: "show-password" },
      { type: "copy", what: "password" },
      { type: "save-model", model: { id: "x", provider: "openai", baseUrl: "", model: "gpt" }, apiKey: "sk" },
      { type: "remove", name: "lunch" },
      { type: "rename", app: "lunch", name: "dinner" },
      { type: "use-model", app: "lunch", model: "x" },
      { type: "add-person", email: "bo@example.com" },
      { type: "share", app: "lunch", email: "ana@example.com", shared: true },
      { type: "new-password" },
      { type: "save-mail", account: { host: "h", port: 465, username: "u", from: "u@example.com" }, password: "p" },
      { type: "phone", on: false },
      { type: "phone-creation", on: false },
      { type: "pair-phone" },
      { type: "forget-phone", id: "a1b2c3d4" },
      { type: "updated" },
      { type: "developer", on: true },
      { type: "code", app: "lunch", version: "1a2b3c4d" },
      { type: "logs", pod: "mayfly-lunch", container: "app" },
      { type: "open-link", url: "https://example.com" },
    ];

    assert.deepEqual(refused.filter(phoneMayAsk), []);
  });
});

describe("what the phone may not ask", () => {
  it("to choose a model, which stays with the computer, as /model does", () => {
    assert.equal(phoneMayAsk({ type: "send", app: null, request: "split lunch bills", model: "openai" }), false);
  });
});

describe("what the phone hears", () => {
  it("the apps at their phone addresses, without who they're shared with, their versions or what they spent", () => {
    assert.deepEqual(forPhone(state), {
      type: "state",
      apps: [{ name: "lunch", url: "https://mayfly.tail1a2b.ts.net:38100/", starred: true, head: "1a2b3c4d", conversation: lunch.conversation }],
      working: null,
    });
  });

  it("nothing of the owner, the people, the models, the mail account or the paired phones", () => {
    const heard = JSON.stringify(forPhone(state));

    for (const secret of ["me@example.com", "ana@example.com", "smtp.example.com", "openai", "a1b2c3d4"]) assert.ok(!heard.includes(secret), secret);
  });

  it("nothing while phone access is off", () => {
    assert.equal(forPhone({ ...state, phoneHost: null }), null);
  });

  it("the stages of the work, but not the model's code or thinking, which are for developers", () => {
    const steps = [{ kind: "writing", attempt: 1 }, { kind: "thinking", text: "Hmm" }, { kind: "draft", text: "export default" }, { kind: "building" }] as const;
    const change: ToUi = { type: "progress", working: { app: "lunch", request: "add tips", kind: "change", since: 1, steps } };
    const ask: ToUi = { type: "progress", working: { app: "lunch", request: "who owes most?", kind: "ask", since: 1, steps } };

    assert.deepEqual(stepsOf(forPhone(change)), ["writing", "building"]);
    assert.deepEqual(stepsOf(forPhone(ask)), ["writing", "draft", "building"]);
    assert.deepEqual(stepsOf(forPhone({ ...state, working: change.working })), ["writing", "building"]);
  });

  it("how the work goes, as the computer hears it", () => {
    const progress: ToUi = { type: "progress", working: { app: "lunch", request: "add tips", kind: "change", since: 1, steps: [] } };

    assert.deepEqual(forPhone(progress), progress);
    assert.deepEqual(forPhone({ type: "created", name: "lunch" }), { type: "created", name: "lunch" });
  });

  it("never a password, a pairing code, an offer to email someone, or what only developers see", () => {
    const withheld: ToUi[] = [
      { type: "password", password: "six-words" },
      { type: "offer-email", about: "welcome", email: "ana@example.com" },
      { type: "code", app: "lunch", version: "1a2b3c4d", routes: "", thinking: "" },
      { type: "logs", pod: "mayfly-lunch", container: "app", lines: [] },
      { type: "ledger", calls: [] },
      { type: "activity", entries: [] },
      { type: "pairing", url: "https://mayfly.tail1a2b.ts.net:38099/#pair=pairing-code", expires: 1 },
    ];

    assert.deepEqual(withheld.map(forPhone), withheld.map(() => null));
  });
});

function stepsOf(heard: ReturnType<typeof forPhone>): string[] {
  const working = heard?.type === "progress" || heard?.type === "state" ? heard.working : null;
  return working?.steps.map((step) => step.kind) ?? [];
}
