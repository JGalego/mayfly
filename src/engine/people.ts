import { randomBytes } from "node:crypto";
import { chosenPassword, newPassword } from "./secrets.ts";
import { OWNER_ROLE, type App, type Person, type State } from "./state.ts";

export const EMAIL = /^[^\s@]+@[^\s@]+$/;

/** Adds someone the owner can share apps with, with a password of their own. */
export function withPerson(state: State, email: string): { readonly state: State; readonly person: Person } {
  const address = email.trim().toLowerCase();
  if (!EMAIL.test(address)) throw new Error("Enter a valid email address");
  if (address === state.owner?.email.toLowerCase()) throw new Error("You can open every app already");
  if (findPerson(state, address) !== undefined) throw new Error(`\`${address}\` is already here`);
  const person = { email: address, password: newPassword(), group: newGroup() };
  return { state: { ...state, people: [...state.people, person] }, person };
}

/** A new password, random unless they chose one, and a new group with it, so every session the old one opened ends. */
export function withNewPassword(state: State, email: string, chosen?: string): { readonly state: State; readonly person: Person } {
  const person = { ...existingPerson(state, email), password: chosen === undefined ? newPassword() : chosenPassword(chosen), group: newGroup() };
  return { state: { ...state, people: state.people.map((other) => (other.email === person.email ? person : other)) }, person };
}

/** Removes someone, and every app they could open stops letting them in. */
export function withoutPerson(state: State, email: string): State {
  const { email: gone } = existingPerson(state, email);
  return {
    ...state,
    people: state.people.filter((person) => person.email !== gone),
    apps: state.apps.map((app) => (peopleOf(app).includes(gone) ? { ...app, people: peopleOf(app).filter((other) => other !== gone) } : app)),
  };
}

/** Lets someone open an app, or no longer. */
export function sharing(state: State, appName: string, email: string, shared: boolean): State {
  const { email: address } = existingPerson(state, email);
  return {
    ...state,
    apps: state.apps.map((app) => {
      if (app.name !== appName) return app;
      const others = peopleOf(app).filter((other) => other !== address);
      return { ...app, people: shared ? [...others, address] : others };
    }),
  };
}

/** The groups an app's auth proxy lets in: the owner's, and the group of each person it's shared with. */
export function allowedGroups(state: State, app: App): string[] {
  const groups = peopleOf(app).flatMap((email) => findPerson(state, email)?.group ?? []);
  return [OWNER_ROLE, ...groups];
}

/** The people an app is shared with, by email. */
export function peopleOf(app: App): readonly string[] {
  return app.people ?? [];
}

export function findPerson(state: State, email: string): Person | undefined {
  const address = email.trim().toLowerCase();
  return state.people.find((person) => person.email === address);
}

function existingPerson(state: State, email: string): Person {
  const person = findPerson(state, email);
  if (person === undefined) throw new Error(`No one called \`${email}\` is here`);
  return person;
}

// Never used twice, so a session opened under an old one gets in nowhere.
function newGroup(): string {
  return `person-${randomBytes(8).toString("hex")}`;
}
