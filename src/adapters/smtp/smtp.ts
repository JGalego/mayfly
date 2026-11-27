import { createTransport } from "nodemailer";

/** A mail server, and the account to sign in to it with. */
export interface SmtpAccount {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
}

/** An email: its plain text, its HTML, and the images the HTML shows by Content-ID. */
export interface Message {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly images: readonly { readonly cid: string; readonly filename: string; readonly content: Uint8Array }[];
}

// Port 465 speaks TLS from the first byte, as RFC 8314 has it. Any other port must switch to TLS with STARTTLS.
const IMPLICIT_TLS = 465;
// A wrong server or port says so in seconds. Nodemailer's defaults wait up to two minutes.
const TIMEOUT_MS = 20_000;

/** Signs in to the server, which proves the account works without sending anything. */
export async function verify(account: SmtpAccount): Promise<void> {
  const transport = transportFor(account);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

export async function send(account: SmtpAccount, { images, ...message }: Message): Promise<void> {
  const transport = transportFor(account);
  try {
    await transport.sendMail({ ...message, attachments: images.map(({ cid, filename, content }) => ({ cid, filename, content: Buffer.from(content) })) });
  } finally {
    transport.close();
  }
}

// The password goes only over TLS, to a server whose certificate the system trusts: requireTLS refuses a server
// that won't switch to it, and Node checks the certificate unless told not to.
function transportFor({ host, port, username, password }: SmtpAccount) {
  return createTransport({
    host,
    port,
    secure: port === IMPLICIT_TLS,
    requireTLS: true,
    auth: { user: username, pass: password },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });
}
