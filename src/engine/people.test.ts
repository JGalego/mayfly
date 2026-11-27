import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allowedGroups, findPerson, sharing, withNewPassword, withoutPerson, withPerson } from "./people.ts";
import { EMPTY_STATE, OWNER_ROLE, type App, type State } from "./state.ts";
import { NO_USAGE } from "./usage.ts";

const owner = { email: "me@mayfly.local", username: "me", password: "six-words-only-the-owner-knows" };
const lunch: App = { name: "lunch", hostPort: 18100, clientSecret: "c", cookieSecret: "k", model: null, starred: false, versions: [], head: null, conversation: [], spent: NO_USAGE };
const state: State = { ...EMPTY_STATE, owner, apps: [lunch] };

describe("adding a person", () => {
  it("gives them a six-word password and a sign-in group of their own", () => {
    const { state: next, person } = withPerson(state, " Ana@Example.com ");

    assert.equal(person.email, "ana@example.com");
    assert.equal(person.password.split("-").length, 6);
    assert.match(person.group, /^person-[0-9a-f]{16}$/);
    assert.deepEqual(next.people, [person]);
  });

  it("gives each person a different group", () => {
    const { state: one } = withPerson(state, "ana@example.com");
    const { state: two } = withPerson(one, "bo@example.com");

    assert.notEqual(two.people[0]?.group, two.people[1]?.group);
  });

  it("refuses an address that isn't one, the owner's, or someone's already there", () => {
    const { state: withAna } = withPerson(state, "ana@example.com");

    assert.throws(() => withPerson(state, "ana"), /valid email/);
    assert.throws(() => withPerson(state, "ME@mayfly.local"), /That's you/);
    assert.throws(() => withPerson(withAna, "ANA@example.com"), /already/);
  });
});

describe("sharing an app", () => {
  const { state: withAna, person: ana } = withPerson(state, "ana@example.com");

  it("lets in the owner alone until it's shared", () => {
    assert.deepEqual(allowedGroups(withAna, lunch), [OWNER_ROLE]);
  });

  it("lets in each person it's shared with, by their group", () => {
    const shared = sharing(withAna, "lunch", ana.email, true);

    assert.deepEqual(allowedGroups(shared, findApp(shared)), [OWNER_ROLE, ana.group]);
  });

  it("stops letting them in once it's no longer shared with them", () => {
    const unshared = sharing(sharing(withAna, "lunch", ana.email, true), "lunch", ana.email, false);

    assert.deepEqual(allowedGroups(unshared, findApp(unshared)), [OWNER_ROLE]);
  });

  it("shares only with people Mayfly knows", () => {
    assert.throws(() => sharing(withAna, "lunch", "stranger@example.com", true), /No one/);
  });
});

describe("a person's new password", () => {
  const { state: withAna, person: ana } = withPerson(state, "ana@example.com");
  const shared = sharing(withAna, "lunch", ana.email, true);

  it("comes with a new group, so every session they had ends, and their apps let in only the new one", () => {
    const { state: next, person } = withNewPassword(shared, ana.email);

    assert.notEqual(person.password, ana.password);
    assert.notEqual(person.group, ana.group);
    assert.deepEqual(allowedGroups(next, findApp(next)), [OWNER_ROLE, person.group]);
  });
});

describe("removing a person", () => {
  const { state: withAna, person: ana } = withPerson(state, "ana@example.com");
  const shared = sharing(withAna, "lunch", ana.email, true);

  it("takes them off every app, so their group gets in nowhere", () => {
    const next = withoutPerson(shared, ana.email);

    assert.equal(findPerson(next, ana.email), undefined);
    assert.deepEqual(allowedGroups(next, findApp(next)), [OWNER_ROLE]);
    assert.deepEqual(findApp(next).people, []);
  });
});

function findApp(state: State): App {
  const app = state.apps.find((candidate) => candidate.name === "lunch");
  assert.ok(app);
  return app;
}
