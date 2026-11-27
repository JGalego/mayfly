import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mailto, newPasswordMail, plainText, sharedMail, welcomeMail } from "./invitations.ts";

const ana = { email: "ana@example.com", password: "thank-machine-dreamless-unease-landless-reverence" };
const LINK = "https://mayfly.tail1a2b.ts.net:38100/";

describe("the emails Mayfly sends, or drafts for the owner to send", () => {
  it("welcomes someone with their email and password, and how they reach the apps", () => {
    const mail = welcomeMail(ana);

    assert.equal(mail.to, ana.email);
    assert.match(plainText(mail), /Email: ana@example\.com\nPassword: thank-machine-dreamless-unease-landless-reverence/);
    assert.match(plainText(mail), /Tailscale/);
  });

  it("sends a shared app's address, and never the password again", () => {
    const mail = sharedMail(ana.email, "lunch-split", LINK);

    assert.match(mail.subject, /lunch-split/);
    assert.deepEqual(mail.parts.find((part) => part.kind === "open"), { kind: "open", app: "lunch-split", url: LINK });
    assert.match(plainText(mail), /\n\nhttps:\/\/mayfly\.tail1a2b\.ts\.net:38100\/\n\n/);
    assert.doesNotMatch(plainText(mail), /thank-machine/);
  });

  it("sends a new password, and says the old one no longer works", () => {
    const mail = newPasswordMail({ ...ana, password: "another-six-words-for-the-guest" });

    assert.match(plainText(mail), /Password: another-six-words-for-the-guest/);
    assert.match(plainText(mail), /old one no longer works/);
  });

  it("says in the subject and the text that the apps are made with Mayfly", () => {
    for (const mail of [welcomeMail(ana), sharedMail(ana.email, "lunch-split", LINK), newPasswordMail(ana)]) {
      assert.match(mail.subject, /Mayfly/);
      assert.match(plainText(mail), /Mayfly/);
    }
  });

  it("opens in the mail app as a draft, with line breaks mail apps keep", () => {
    const link = new URL(mailto({ to: "ana@example.com", subject: "Hi & bye", parts: [{ kind: "text", text: "one" }, { kind: "text", text: "two" }] }));

    assert.equal(link.protocol, "mailto:");
    assert.equal(link.pathname, "ana@example.com");
    assert.equal(link.searchParams.get("subject"), "Hi & bye");
    assert.equal(link.searchParams.get("body"), "one\r\n\r\ntwo");
  });
});
