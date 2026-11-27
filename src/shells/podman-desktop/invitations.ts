/** An email in the owner's voice, which Mayfly sends from their account or drafts in their mail app. */
export interface Mail {
  readonly to: string;
  readonly subject: string;
  readonly parts: readonly Part[];
}

/** A paragraph, the email and password to sign in with, or an app to open. */
export type Part =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "sign-in"; readonly email: string; readonly password: string }
  | { readonly kind: "open"; readonly app: string; readonly url: string };

interface Credentials {
  readonly email: string;
  readonly password: string;
}

export function welcomeMail({ email, password }: Credentials): Mail {
  return {
    to: email,
    subject: "Your sign-in for my Mayfly apps",
    parts: [
      text("Hi,"),
      text("I've added you to some apps I made with Mayfly. When one asks you to sign in, use:"),
      { kind: "sign-in", email, password },
      text("The apps run on my computer, and you reach them through Tailscale. Install it from https://tailscale.com/download, then accept my invitation when it arrives."),
      text("I'll send you a link to each app I share with you."),
    ],
  };
}

export function sharedMail(email: string, app: string, url: string): Mail {
  return {
    to: email,
    subject: `${app}, made with Mayfly, is ready for you`,
    parts: [
      text("Hi,"),
      text(`You can now open ${app}, an app I made with Mayfly:`),
      { kind: "open", app, url },
      text(`Sign in as ${email}, with the password I sent you. Tailscale needs to be on, on the device you open it from.`),
    ],
  };
}

export function newPasswordMail({ email, password }: Credentials): Mail {
  return {
    to: email,
    subject: "Your new password for my Mayfly apps",
    parts: [text("Hi,"), text("Your password for my Mayfly apps has changed. Sign in with:"), { kind: "sign-in", email, password }, text("The old one no longer works.")],
  };
}

/** The email as plain text: the whole of a draft, and the part of a sent email that mail apps without HTML show. */
export function plainText({ parts }: Mail): string {
  return parts.map(partText).join("\n\n");
}

/** A link that opens the mail in the owner's mail app, as a draft. */
export function mailto(mail: Mail): string {
  const query = new URLSearchParams({ subject: mail.subject, body: plainText(mail).replaceAll("\n", "\r\n") }).toString().replaceAll("+", "%20");
  return `mailto:${encodeURIComponent(mail.to).replace("%40", "@")}?${query}`;
}

function partText(part: Part): string {
  switch (part.kind) {
    case "text":
      return part.text;
    case "sign-in":
      return `Email: ${part.email}\nPassword: ${part.password}`;
    case "open":
      return part.url;
  }
}

function text(words: string): Part {
  return { kind: "text", text: words };
}
