import type { Mail, Part } from "./invitations.ts";

/** The logo the HTML shows, which whoever sends the email attaches under this Content-ID. */
export const LOGO = { cid: "logo@mayfly", filename: "mayfly.png" } as const;

// Mayfly's colours, from its logo: the mayfly's ink, the sun's cream, and warm paper behind.
const INK = "#2a1e3f";
const MUTED = "#6b6477";
const CREAM = "#fff3d1";
const PAPER = "#f7f3ee";
const EDGE = "#ebe4da";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
// Everything up to the next space, short of punctuation that ends the sentence.
const WEB_ADDRESS = /https:\/\/\S*[^\s.,;:!?)]/g;

/** The email as HTML. Mail apps agree on little but tables and inline styles, so it uses nothing else. */
export function htmlOf(mail: Mail): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escape(mail.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${PAPER};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:100%;max-width:480px;background:#ffffff;border:1px solid ${EDGE};border-radius:12px;">
<tr><td style="padding:28px 32px 0;">${header()}</td></tr>
<tr><td style="padding:20px 32px 12px;font-family:${SANS};font-size:16px;line-height:1.5;color:${INK};">
${mail.parts.map(partHtml).join("\n")}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}

// The logo is decoration beside the name, so it has no text of its own.
function header(): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle;"><img src="cid:${LOGO.cid}" width="40" height="40" alt="" style="display:block;border:0;"></td>
<td style="vertical-align:middle;padding-left:12px;font-family:${SANS};font-size:18px;font-weight:700;color:${INK};">Mayfly</td>
</tr></table>`;
}

function partHtml(part: Part): string {
  switch (part.kind) {
    case "text":
      return `<p style="margin:0 0 16px;">${linked(part.text)}</p>`;
    case "sign-in":
      return signIn(part.email, part.password);
    case "open":
      return openButton(part.app, part.url);
  }
}

function signIn(email: string, password: string): string {
  const fact = (label: string, value: string, last: boolean): string =>
    `<div style="font-size:13px;color:${MUTED};">${label}</div>\n<div style="font-family:${MONO};font-size:15px;${last ? "" : "margin-bottom:10px;"}">${escape(value)}</div>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;background:${CREAM};border-radius:8px;">
<tr><td style="padding:14px 18px;">
${fact("Email", email, false)}
${fact("Password", password, true)}
</td></tr>
</table>`;
}

function openButton(app: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 8px;"><tr>
<td style="background:${INK};border-radius:8px;"><a href="${escape(url)}" style="display:inline-block;padding:12px 22px;font-family:${SANS};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">Open ${escape(app)}</a></td>
</tr></table>
<p style="margin:0 0 16px;font-size:13px;color:${MUTED};word-break:break-all;">${link(url, MUTED)}</p>`;
}

/** Text with its web addresses as links. */
function linked(text: string): string {
  let html = "";
  let from = 0;
  for (const match of text.matchAll(WEB_ADDRESS)) {
    html += escape(text.slice(from, match.index)) + link(match[0], INK);
    from = match.index + match[0].length;
  }
  return html + escape(text.slice(from));
}

function link(url: string, colour: string): string {
  return `<a href="${escape(url)}" style="color:${colour};">${escape(url)}</a>`;
}

function escape(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
