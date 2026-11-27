import type { MailAccountView } from "../mail-account.ts";
import type { FromUi } from "../messages.ts";
import { h } from "./dom.ts";

type Post = (message: FromUi) => void;

// Implicit TLS, which RFC 8314 prefers, and the port most providers give first.
const DEFAULT_PORT = 465;

const host = element<HTMLInputElement>("mail-host");
const port = element<HTMLInputElement>("mail-port");
const username = element<HTMLInputElement>("mail-username");
const password = element<HTMLInputElement>("mail-password");
const from = element<HTMLInputElement>("mail-from");

let editing = false;
/** A save the extension is checking with the server. The form closes when it's kept, and stays open, as typed, when it isn't. */
let saving = false;

/** Wires the Email section of Settings → People to the extension. */
export function setUpMail(post: Post, redraw: () => void): void {
  element("add-mail").addEventListener("click", () => {
    openForm(undefined);
    redraw();
  });
  element("cancel-mail").addEventListener("click", () => {
    editing = false;
    password.value = "";
    redraw();
  });
  element("mail-form").addEventListener("submit", (event) => {
    event.preventDefault();
    saving = true;
    post({ type: "save-mail", account: { host: host.value, port: Number(port.value), username: username.value, from: from.value }, password: password.value });
    redraw();
  });
}

/** The extension answered a save: with the new state when it kept the account, with an error when it did not. */
export function savedMail(kept: boolean): void {
  if (!saving) return;
  saving = false;
  if (!kept) return;
  editing = false;
  password.value = "";
}

/** The account Mayfly sends email from, or the way to add one. */
export function renderMail(account: MailAccountView | null, post: Post, redraw: () => void): void {
  const list = element("mail-account");
  list.hidden = account === null;
  list.replaceChildren(...(account === null ? [] : [accountCard(account, post, redraw)]));
  element("mail-form").hidden = !editing;
  element("add-mail").hidden = editing || account !== null;
  const save = element<HTMLButtonElement>("save-mail");
  save.disabled = saving;
  save.textContent = saving ? "Signing in…" : "Save";
}

function accountCard(account: MailAccountView, post: Post, redraw: () => void): HTMLLIElement {
  const server = `${account.host}:${account.port}`;
  const facts = h("p", "quiet", account.username === account.from ? server : `${server} · signs in as ${account.username}`);
  const actions = [
    button("Change", () => {
      openForm(account);
      redraw();
    }),
    button("Remove", () => post({ type: "remove-mail" })),
  ];
  return h("li", "model-card", h("div", "model-facts", h("p", "model-label", account.from), facts), h("div", "model-actions", ...actions));
}

function openForm(account: MailAccountView | undefined): void {
  editing = true;
  host.value = account?.host ?? "";
  port.value = String(account?.port ?? DEFAULT_PORT);
  username.value = account?.username ?? "";
  from.value = account === undefined || account.from === account.username ? "" : account.from;
  password.value = "";
  password.required = account === undefined;
  password.placeholder = account === undefined ? "" : "Leave blank to keep the saved password";
  element("mail-form-title").textContent = account === undefined ? "Add a mail account" : "Change the mail account";
}

function button(label: string, act: () => void): HTMLButtonElement {
  const control = h("button", "quiet-button", label);
  control.type = "button";
  control.addEventListener("click", act);
  return control;
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
