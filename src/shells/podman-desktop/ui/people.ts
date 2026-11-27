import type { AppView } from "../../../engine/engine.ts";
import type { FromUi, MailAbout } from "../messages.ts";
import { nameChip } from "./chips.ts";
import { h } from "./dom.ts";
import { icon, type IconName } from "./icons.ts";
import { passwordCard, PASSWORD_SHOWN_MS } from "./password-card.ts";

type Post = (message: FromUi) => void;

// A new password or a removal locks someone out, so each takes a second click.
const CONFIRM_MS = 4000;
// Where the owner shares this computer with someone in Tailscale, which they need to reach it.
const TAILSCALE_MACHINES = "https://login.tailscale.com/admin/machines";

let post: Post = () => {};
let redraw = (): void => {};
/** The address Mayfly sends email from, as the People section last showed it. */
let sender: string | null = null;
/** Someone's password on show, and what hides it again. */
let shown: { readonly email: string; readonly password: string; readonly timer: number } | undefined;
/** Someone's new password or removal, waiting for its second click. */
let armed: { readonly email: string; readonly action: "reset" | "remove"; readonly timer: number } | undefined;
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

/** Everyone the owner can share apps with. Who opens what lives with each app, in its Share popover. */
export function renderPeople(people: readonly string[], phoneOn: boolean, from: string | null): void {
  sender = from;
  element("people-phone-note").hidden = phoneOn;
  const input = element<HTMLInputElement>("person-email");
  // Added: the field is free for the next one.
  if (people.includes(input.value.trim().toLowerCase())) input.value = "";
  const key = JSON.stringify([people, shown?.email, armed?.email, armed?.action]);
  if (key === peopleBuilt) return;
  peopleBuilt = key;
  element("people").hidden = people.length === 0;
  element("people").replaceChildren(...people.map(personCard));
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
  if (from !== null) return ["Mayfly emails them ", ...what, " from ", nameChip(from), "."];
  return ["Mayfly drafts an email in your mail app with ", ...what, ", for you to send. To have Mayfly send it, add a mail account in Settings → People."];
}

function shareNote(anyone: boolean, phoneOn: boolean, busy: boolean): string {
  if (busy) return "Restarting the app with the new access…";
  if (!anyone) return "Add people in Settings to share this app.";
  if (!phoneOn) return "Turn on phone access in Settings first. Other people open apps through Tailscale.";
  return "When you add someone, Mayfly offers to email them the link.";
}

function shareOption(label: string, checked: boolean, disabled: boolean, change: (on: boolean) => void): HTMLElement {
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  box.disabled = disabled;
  box.addEventListener("change", () => change(box.checked));
  return h("li", "", h("label", "check", box, label));
}

function personCard(email: string): HTMLElement {
  const showing = shown?.email === email ? shown : undefined;
  const facts = h("div", "person-facts", h("span", "person-email", email));
  const actions = h(
    "div",
    "person-actions",
    action(showing === undefined ? "eye" : "eye-off", showing === undefined ? "Show" : "Hide", `${showing === undefined ? "Show" : "Hide"} ${email}'s password`, () =>
      showing === undefined ? post({ type: "show-password", email }) : hidePassword(),
    ),
    action("mail", "Email again", `Email ${email} their password again`, () => offerEmail({ about: "welcome", email }, sender)),
    confirming(email, "reset", "Reset password", "Confirm reset", () => post({ type: "new-password", email })),
    confirming(email, "remove", "Remove", "Confirm removal", () => post({ type: "remove-person", email })),
  );
  const card = h("li", "person-card", facts, actions);
  if (showing !== undefined) card.append(h("div", "password-shown", ...passwordCard(showing.password)));
  return card;
}

function action(name: IconName, label: string, describe: string, act: () => void): HTMLButtonElement {
  const control = h("button", "quiet-button with-icon", icon(name), label);
  control.type = "button";
  control.setAttribute("aria-label", describe);
  control.addEventListener("click", act);
  return control;
}

function confirming(email: string, kind: "reset" | "remove", label: string, confirm: string, act: () => void): HTMLButtonElement {
  const waiting = armed?.email === email && armed.action === kind;
  const control = h("button", waiting ? "quiet-button armed" : "quiet-button", waiting ? confirm : label);
  control.type = "button";
  control.addEventListener("click", () => {
    disarm();
    if (waiting) {
      if (kind === "reset" && shown?.email === email) hidePassword();
      act();
    } else armed = { email, action: kind, timer: window.setTimeout(() => (disarm(), redraw()), CONFIRM_MS) };
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
