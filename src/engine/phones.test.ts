import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { offerPairing, PAIRING_LIFETIME_MS, phoneWith, withoutPhone, withPhone } from "./phones.ts";
import { EMPTY_STATE } from "./state.ts";

const NOW = Date.parse("2026-11-27T12:00:00Z");

function paired(state = EMPTY_STATE, name = "iPhone") {
  const { code, offer } = offerPairing(NOW);
  return withPhone(state, offer, code, name, NOW + 1000);
}

describe("pairing a phone", () => {
  it("gives the phone holding the code a long random token, and keeps only the token's hash", () => {
    const { state, token, phone } = paired();

    assert.match(token, /^[\w-]{43}$/);
    assert.deepEqual(state.phones, [phone]);
    assert.equal(phone.name, "iPhone");
    assert.equal(phone.pairedAt, NOW + 1000);
    assert.ok(!JSON.stringify(state).includes(token));
  });

  it("knows the phone by its token, and no phone by any other", () => {
    const one = paired();
    const two = paired(one.state, "Pixel");

    assert.equal(phoneWith(two.state, one.token)?.id, one.phone.id);
    assert.equal(phoneWith(two.state, two.token)?.id, two.phone.id);
    assert.notEqual(one.token, two.token);
    assert.equal(phoneWith(two.state, "a-token-nobody-was-given"), undefined);
  });

  it("refuses a wrong code, a code past its five minutes, and any code when none is offered", () => {
    const { code, offer } = offerPairing(NOW);

    assert.throws(() => withPhone(EMPTY_STATE, offer, "not-the-code", "iPhone", NOW), /doesn't work/);
    assert.throws(() => withPhone(EMPTY_STATE, offer, code, "iPhone", NOW + PAIRING_LIFETIME_MS + 1), /doesn't work/);
    assert.throws(() => withPhone(EMPTY_STATE, null, code, "iPhone", NOW), /doesn't work/);
    assert.equal(withPhone(EMPTY_STATE, offer, code, "iPhone", NOW + PAIRING_LIFETIME_MS).state.phones.length, 1);
  });

  it("makes a different code each time, long enough that nobody guesses it", () => {
    const one = offerPairing(NOW);
    const two = offerPairing(NOW);

    assert.match(one.code, /^[\w-]{22}$/);
    assert.notEqual(one.code, two.code);
  });

  it("names the phone as its browser says, trimmed and kept short, or just Phone", () => {
    assert.equal(paired(EMPTY_STATE, "  iPad ").phone.name, "iPad");
    assert.equal(paired(EMPTY_STATE, "x".repeat(100)).phone.name.length, 40);
    assert.equal(paired(EMPTY_STATE, " ").phone.name, "Phone");
  });
});

describe("forgetting a phone", () => {
  it("stops its token working, and leaves the others paired", () => {
    const one = paired();
    const two = paired(one.state, "Pixel");

    const state = withoutPhone(two.state, one.phone.id);

    assert.equal(phoneWith(state, one.token), undefined);
    assert.equal(phoneWith(state, two.token)?.id, two.phone.id);
  });
});
