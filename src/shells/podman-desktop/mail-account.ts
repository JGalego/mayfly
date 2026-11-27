import { EMAIL } from "../../engine/people.ts";
import { plainText, type Mail } from "./invitations.ts";
import { htmlOf } from "./mail-html.ts";

/** A mail account Mayfly sends email from: its server, how to sign in to it, and the address emails come from. */
export interface MailAccount {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
  readonly from: string;
}

/** The account as the page sees it: never its password. */
export type MailAccountView = Omit<MailAccount, "password">;

/** An email ready to go: who it's from and to, and what it says, as plain text and as HTML. */
export interface Outgoing {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface MailPorts {
  readonly mail: {
    /** The account, if the owner set one up. Without one, Mayfly drafts emails in their mail app instead. */
    account(): Promise<MailAccount | undefined>;
    save(account: MailAccount): Promise<void>;
    remove(): Promise<void>;
    /** Signs in to the account's server, and fails with the server's reason if it can't. */
    verify(account: MailAccount): Promise<void>;
    send(account: MailAccount, message: Outgoing): Promise<void>;
  };
}

const MAX_FIELD = 254;
// A server's name, without a scheme or a port: those have fields of their own.
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/** Keeps the account once its server lets Mayfly sign in with it. Returns what is wrong, if anything. */
export async function saveMailAccount(view: MailAccountView, password: string, { mail }: MailPorts): Promise<string | undefined> {
  const account = cleaned(view, password, await mail.account());
  const problem = problemWith(account);
  if (problem !== undefined) return problem;
  const refused = await mail.verify(account).then(
    () => undefined,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  if (refused !== undefined) return `Mayfly couldn't sign in to \`${account.host}\`: ${refused}`;
  await mail.save(account);
  return undefined;
}

export async function mailAccountView({ mail }: MailPorts): Promise<MailAccountView | null> {
  const account = await mail.account();
  return account === undefined ? null : { host: account.host, port: account.port, username: account.username, from: account.from };
}

/** The email as it leaves from the account. */
export function outgoing(mail: Mail, { from }: MailAccount): Outgoing {
  return { from, to: mail.to, subject: mail.subject, text: plainText(mail), html: htmlOf(mail) };
}

// The account comes from the page, so it is checked for its shape before anything uses it.
export function readMailAccount(value: unknown): MailAccountView | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { host, port, username, from } = value as Record<string, unknown>;
  const valid = typeof host === "string" && typeof port === "number" && typeof username === "string" && typeof from === "string";
  return valid ? { host, port, username, from } : undefined;
}

// A blank password keeps the saved one, but only for the same server and username, so it never goes to a server it wasn't given for.
function cleaned(view: MailAccountView, password: string, saved: MailAccount | undefined): MailAccount {
  const host = view.host.trim().toLowerCase();
  const username = view.username.trim();
  const same = saved !== undefined && saved.host === host && saved.port === view.port && saved.username === username;
  return { host, port: view.port, username, password: password === "" && same ? saved.password : password, from: view.from.trim() || username };
}

function problemWith({ host, port, username, password, from }: MailAccount): string | undefined {
  if (!HOST.test(host) || host.length > MAX_FIELD) return "Give the server's name, such as smtp.gmail.com.";
  if (!Number.isInteger(port) || port < 1 || port > 65535) return "Give the server's port, such as 465 or 587.";
  if (username === "" || username.length > MAX_FIELD) return "Give the username you sign in to the server with.";
  if (password === "") return "Enter the account's password.";
  if (!EMAIL.test(from) || from.length > MAX_FIELD) return "Give the address emails come from, such as you@example.com.";
  return undefined;
}
