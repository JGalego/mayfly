/** An email for the owner to send from their own mail app. Mayfly sends nothing itself. */
export interface Mail {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

interface Credentials {
  readonly email: string;
  readonly password: string;
}

// In the owner's voice: they send it.
export function welcomeMail({ email, password }: Credentials): Mail {
  return {
    to: email,
    subject: "Your sign-in for my apps",
    body: [
      "Hi,",
      "",
      "I've added you to some apps I made. When one asks you to sign in, use:",
      "",
      `Email: ${email}`,
      `Password: ${password}`,
      "",
      "The apps run on my computer, and you reach them through Tailscale. Install it from https://tailscale.com/download, then accept my invitation when it arrives.",
      "",
      "I'll send you a link to each app I share with you.",
    ].join("\n"),
  };
}

export function sharedMail(email: string, app: string, url: string): Mail {
  return {
    to: email,
    subject: `${app} is ready for you`,
    body: ["Hi,", "", `You can now open ${app}: ${url}`, "", `Sign in as ${email}, with the password I sent you. Tailscale needs to be on, on the device you open it from.`].join("\n"),
  };
}

export function newPasswordMail({ email, password }: Credentials): Mail {
  return {
    to: email,
    subject: "Your new password for my apps",
    body: ["Hi,", "", "Your password for my apps has changed. Sign in with:", "", `Email: ${email}`, `Password: ${password}`, "", "The old one no longer works."].join("\n"),
  };
}

/** A link that opens the mail in the owner's mail app, as a draft. */
export function mailto({ to, subject, body }: Mail): string {
  const query = new URLSearchParams({ subject, body: body.replaceAll("\n", "\r\n") }).toString().replaceAll("+", "%20");
  return `mailto:${encodeURIComponent(to).replace("%40", "@")}?${query}`;
}
