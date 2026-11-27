import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mailto, newPasswordMail, sharedMail, welcomeMail } from "./invitations.ts";

const ana = { email: "ana@example.com", password: "thank-machine-dreamless-unease-landless-reverence" };

describe("the emails Mayfly drafts for the owner to send", () => {
  it("welcomes someone with their email and password, and how they reach the apps", () => {
    const mail = welcomeMail(ana);

    assert.equal(mail.to, ana.email);
    assert.match(mail.body, /Email: ana@example\.com/);
    assert.match(mail.body, /Password: thank-machine-dreamless-unease-landless-reverence/);
    assert.match(mail.body, /Tailscale/);
  });

  it("sends a shared app's address, and never the password again", () => {
    const mail = sharedMail(ana.email, "lunch-split", "https://mayfly.tail1a2b.ts.net:38100/");

    assert.match(mail.subject, /lunch-split/);
    assert.match(mail.body, /https:\/\/mayfly\.tail1a2b\.ts\.net:38100\//);
    assert.doesNotMatch(mail.body, /thank-machine/);
  });

  it("sends a new password, and says the old one no longer works", () => {
    const mail = newPasswordMail({ ...ana, password: "another-six-words-for-the-guest" });

    assert.match(mail.body, /Password: another-six-words-for-the-guest/);
    assert.match(mail.body, /old one no longer works/);
  });

  it("opens in the mail app as a draft, with line breaks mail apps keep", () => {
    const link = new URL(mailto({ to: "ana@example.com", subject: "Hi & bye", body: "one\ntwo" }));

    assert.equal(link.protocol, "mailto:");
    assert.equal(link.pathname, "ana@example.com");
    assert.equal(link.searchParams.get("subject"), "Hi & bye");
    assert.equal(link.searchParams.get("body"), "one\r\ntwo");
  });
});
