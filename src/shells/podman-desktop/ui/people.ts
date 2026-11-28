import type { AppView } from "../../../engine/engine.ts";
import type { FromUi, MailAbout } from "../messages.ts";
import { nameChip } from "./chips.ts";
import { h } from "./dom.ts";
import { icon, type IconName } from "./icons.ts";
import { passwordCard, PASSWORD_SHOWN_MS } from "./password-card.ts";

type Post = (message: FromUi) => void;

// A removal locks someone out, so it takes a second click.
const CONFIRM_MS = 4000;
const COPIED_MS = 1500;
// Where the owner shares this computer with someone in Tailscale, which they need to reach it.
const TAILSCALE_MACHINES = "https://login.tailscale.com/admin/machines";

let post: Post = () => {};
let redraw = (): void => {};
/** The address Mayfly sends email from, as the People section last showed it. */
let sender: string | null = null;
/** Someone's password on show, and what hides it again. */
let shown: { readonly email: string; readonly password: string; readonly timer: number } | undefined;
/** Someone's removal, waiting for its second click. */
let armed: { readonly email: string; readonly timer: number } | undefined;
/** A password, or the owner's email, being typed into someone's card. */
let editing: { readonly email: string; readonly what: "password" | "email" } | undefined;
/** Apps running again with whom they let in, until the state says they're done. */
const sharing = new Set<string>();
/** What the list and the popover were last built from, so a redraw keeps focus and the password's timer where they are. */
let peopleBuilt = "";
let shareBuilt = "";

/** Wires the People section of Settings and the Share popover to the extension. */
export function setUpPeople(send: Post, rerender: () => void, openPeople: () => void): void {
  post = send;
  redraw = rerender;
  element("person-form").addEventListener("submit", (event) => {
    event.preventDefault();
    post({ type: "add-person", email: element<HTMLInputElement>("person-email").value });
  });
  element("share-tailscale").addEventListener("click", () => post({ type: "open-link", url: TAILSCALE_MACHINES }));
  element("share-people-settings").addEventListener("click", openPeople);
}

/** Asks whether to email someone about what just changed for them, and if so, sends it or drafts it in the owner's mail app. */
export function offerEmail(mail: MailAbout, from: string | null): void {
  const dialog = element<HTMLDialogElement>("email-dialog");
  const titles = { welcome: "their sign-in", "new-password": "their new password", shared: "the link" };
  element("email-title").replaceChildren("Email ", nameChip(mail.email), ` ${titles[mail.about]}?`);
  element("email-text").replaceChildren(...emailText(mail, from));
  element("email-go").replaceChildren(icon("mail"), from === null ? "Draft email" : "Send");
  dialog.returnValue = "";
  dialog.addEventListener("close", () => dialog.returnValue === "email" && post({ ...mail, type: "email" }), { once: true });
  dialog.showModal();
}

/** The state came: whatever sharing was under way has run its course. */
export function settleSharing(): void {
  sharing.clear();
}

export function showPersonPassword(email: string, password: string): void {
  if (shown !== undefined) window.clearTimeout(shown.timer);
  shown = { email, password, timer: window.setTimeout(hidePassword, PASSWORD_SHOWN_MS) };
  redraw();
}

/** The owner, then everyone they can share apps with. Who opens what lives with each app, in its Share popover. */
export function renderPeople(owner: string, people: readonly string[], phoneOn: boolean, from: string | null): void {
  sender = from;
  element("people-phone-note").hidden = phoneOn || people.length === 0;
  const input = element<HTMLInputElement>("person-email");
  // Added: the field is free for the next one.
  if (people.includes(input.value.trim().toLowerCase())) input.value = "";
  const key = JSON.stringify([owner, people, shown?.email, armed?.email, editing]);
  if (key === peopleBuilt) return;
  peopleBuilt = key;
  element("people").replaceChildren(ownerCard(owner), ...people.map(personCard));
  element("people").querySelector<HTMLInputElement>(".card-form input")?.focus();
}

/** Who can open the app: always the owner, and each person it's shared with, while phone access lets them reach it. */
export function renderShare(app: AppView | undefined, people: readonly string[], phoneOn: boolean, unavailable: boolean): void {
  element("share-anchor").hidden = app === undefined;
  element<HTMLButtonElement>("show-share").disabled = unavailable;
  if (app === undefined) return;
  const busy = sharing.has(app.name);
  const key = JSON.stringify([app.name, app.people, people, phoneOn, busy]);
  if (key === shareBuilt) return;
  shareBuilt = key;
  const you = shareOption("You", true, true, () => {});
  const others = people.map((email) =>
    // Off, sharing can be taken back, never given.
    shareOption(email, app.people.includes(email), busy || (!phoneOn && !app.people.includes(email)), (on) => {
      sharing.add(app.name);
      post({ type: "share", app: app.name, email, shared: on });
      redraw();
    }),
  );
  element("share-list").replaceChildren(you, ...others);
  element("share-note").textContent = shareNote(people.length > 0, phoneOn, busy);
  element("share-people-settings").hidden = people.length > 0 && phoneOn;
}

function emailText(mail: MailAbout, from: string | null): (Node | string)[] {
  const what = mail.about === "shared" ? ["the link to ", nameChip(mail.app)] : ["their password"];
  if (from !== null) return ["Mayfly emails them ", ...what, " from ", nameChip(from)];
  return ["Mayfly drafts an email with ", ...what, " in your mail app for you to send"];
}

function shareNote(anyone: boolean, phoneOn: boolean, busy: boolean): string {
  if (busy) return "Restarting the app with the new access…";
  if (!anyone) return "Add people in Settings to share this app";
  if (!phoneOn) return "Turn on phone access in Settings so others can open it";
  return "Mayfly offers to email the link to anyone you add";
}

function shareOption(label: string, checked: boolean, disabled: boolean, change: (on: boolean) => void): HTMLElement {
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  box.disabled = disabled;
  box.addEventListener("change", () => change(box.checked));
  return h("li", "", h("label", "check", box, label));
}

/** The owner opens every app. Their password shows in the Sign-in details too, and they can copy it, choose it or change their email. */
function ownerCard(email: string): HTMLElement {
  const facts = h("div", "person-facts", h("span", "person-email", email, " ", h("span", "badge", "You")));
  const copy = action("copy", "Copy", "Copy your password", () => {
    post({ type: "copy", what: "password" });
    copy.replaceChildren(icon("check"), "Copied");
    window.setTimeout(() => copy.replaceChildren(icon("copy"), "Copy"), COPIED_MS);
  });
  const actions = h(
    "div",
    "person-actions",
    showing(email, () => post({ type: "show-password" })),
    copy,
    action("key", "Change password", "Change your password", () => edit(email, "password")),
    action("pencil", "Change email", "Change your email", () => edit(email, "email")),
  );
  return card(email, facts, actions, (value, what) => post(what === "password" ? { type: "new-password", ...(value === undefined ? {} : { password: value }) } : { type: "owner-email", email: value ?? email }));
}

function personCard(email: string): HTMLElement {
  const facts = h("div", "person-facts", h("span", "person-email", email));
  const actions = h(
    "div",
    "person-actions",
    showing(email, () => post({ type: "show-password", email })),
    action("mail", "Email again", `Email ${email} their password again`, () => offerEmail({ about: "welcome", email }, sender)),
    action("key", "Change password", `Change ${email}'s password`, () => edit(email, "password")),
    confirming(email, "Remove", "Confirm removal", () => post({ type: "remove-person", email })),
  );
  return card(email, facts, actions, (value) => post({ type: "new-password", email, ...(value === undefined ? {} : { password: value }) }));
}

/** A person's card: who they are and what to do, then their password while it shows, or the form being typed into. */
/** Saves what the card's form says: a password, none for a random one, or the owner's email. */
type Save = (value: string | undefined, what: "password" | "email") => void;

function card(email: string, facts: HTMLElement, actions: HTMLElement, save: Save): HTMLElement {
  const item = h("li", "person-card", facts, actions);
  if (shown?.email === email) item.append(h("div", "password-shown", ...passwordCard(shown.password)));
  if (editing?.email === email) item.append(editor(email, editing.what, save));
  return item;
}

function showing(email: string, show: () => void): HTMLButtonElement {
  const on = shown?.email === email;
  return action(on ? "eye-off" : "eye", on ? "Hide" : "Show", `${on ? "Hide" : "Show"} ${email}'s password`, () => (on ? hidePassword() : show()));
}

function edit(email: string, what: "password" | "email"): void {
  editing = { email, what };
  redraw();
}

/** A new password, typed and long enough or made at random, or the owner's new email. Either way the old password stops working. */
function editor(email: string, what: "password" | "email", save: Save): HTMLFormElement {
  const input = h("input", "");
  input.required = true;
  input.autocomplete = what === "password" ? "new-password" : "off";
  if (what === "password") {
    input.type = "password";
    input.minLength = 12;
    input.placeholder = "At least 12 characters";
    input.setAttribute("aria-label", `New password for ${email}`);
  } else {
    input.type = "email";
    input.value = email;
    input.setAttribute("aria-label", "Your email");
  }
  const cancel = h("button", "quiet-button", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => {
    editing = undefined;
    redraw();
  });
  const done = (value: string | undefined): void => {
    editing = undefined;
    if (shown?.email === email) hidePassword();
    save(value, what);
    redraw();
  };
  const random = h("button", "secondary", "Make one");
  random.type = "button";
  random.title = "A random password of six words";
  random.addEventListener("click", () => done(undefined));
  const form = h("form", "card-form", input, ...(what === "password" ? [random] : []), cancel, h("button", "primary", "Save"));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    done(input.value);
  });
  return form;
}

function action(name: IconName, label: string, describe: string, act: () => void): HTMLButtonElement {
  const control = h("button", "secondary with-icon", icon(name), label);
  control.type = "button";
  control.setAttribute("aria-label", describe);
  control.addEventListener("click", act);
  return control;
}

function confirming(email: string, label: string, confirm: string, act: () => void): HTMLButtonElement {
  const waiting = armed?.email === email;
  const control = h("button", waiting ? "secondary destructive armed" : "secondary destructive", waiting ? confirm : label);
  control.type = "button";
  control.addEventListener("click", () => {
    disarm();
    if (waiting) act();
    else armed = { email, timer: window.setTimeout(() => (disarm(), redraw()), CONFIRM_MS) };
    redraw();
  });
  return control;
}

function disarm(): void {
  if (armed !== undefined) window.clearTimeout(armed.timer);
  armed = undefined;
}

function hidePassword(): void {
  if (shown !== undefined) window.clearTimeout(shown.timer);
  shown = undefined;
  redraw();
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`no #${id} on the page`);
  return found as T;
}
