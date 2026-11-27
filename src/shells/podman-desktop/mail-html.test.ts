import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { newPasswordMail, sharedMail, welcomeMail } from "./invitations.ts";
import { htmlOf, LOGO } from "./mail-html.ts";

const ana = { email: "ana@example.com", password: "thank-machine-dreamless-unease-landless-reverence" };
const LINK = "https://mayfly.tail1a2b.ts.net:38100/";

describe("an email's HTML", () => {
  it("shows the Mayfly logo, sent with the email rather than fetched from the web", () => {
    assert.match(htmlOf(welcomeMail(ana)), new RegExp(`<img src="cid:${LOGO.cid}"`));
  });

  it("has a button that opens a shared app, with its address to copy too", () => {
    const html = htmlOf(sharedMail(ana.email, "lunch-split", LINK));

    assert.match(html, /<a href="https:\/\/mayfly\.tail1a2b\.ts\.net:38100\/"[^>]*>Open lunch-split<\/a>/);
    assert.match(html, />https:\/\/mayfly\.tail1a2b\.ts\.net:38100\/</);
  });

  it("sets the email and password apart, to read and type", () => {
    const html = htmlOf(newPasswordMail(ana));

    assert.match(html, />ana@example\.com</);
    assert.match(html, />thank-machine-dreamless-unease-landless-reverence</);
  });

  it("links the web addresses in its text, leaving out the punctuation after them", () => {
    assert.match(htmlOf(welcomeMail(ana)), /<a href="https:\/\/tailscale\.com\/download"[^>]*>https:\/\/tailscale\.com\/download<\/a>,/);
  });

  it("shows names and addresses as text, never as markup", () => {
    const html = htmlOf(sharedMail("a&b@example.com", `<script>"x"</script>`, "https://host.ts.net:38100/?a=1&b=2"));

    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;&quot;x&quot;&lt;\/script&gt;/);
    assert.match(html, /href="https:\/\/host\.ts\.net:38100\/\?a=1&amp;b=2"/);
    assert.match(html, /a&amp;b@example\.com/);
  });

  it("is titled with the subject", () => {
    assert.match(htmlOf(welcomeMail(ana)), /<title>Your sign-in for my Mayfly apps<\/title>/);
  });
});
