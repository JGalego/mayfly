import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { send, verify } from "../../src/adapters/smtp/smtp.ts";
import { secret, waitUntilUp } from "./support.ts";

// A mail server that takes mail only over STARTTLS and from one account, with an API to read what it received.
const MAILPIT = "ghcr.io/axllent/mailpit:v1.34.0@sha256:23a2ef85bc50853ab3093645d1d64679afd8887e89da5e48a88940c172591a4e";
const CONTAINER = "mayfly-test-mailpit";
// Well clear of the ports Mayfly gives apps, from 18100 up.
const SMTP_PORT = 18991;
const API_PORT = 18992;
const PLAIN_PORT = 18993;
const API = `http://127.0.0.1:${API_PORT}/api/v1`;

const account = { host: "localhost", port: SMTP_PORT, username: "mayfly", password: secret() };
const certs = mkdtempSync(join(tmpdir(), "mayfly-smtp-"));
const SYSTEM_AUTHORITIES = tls.getCACertificates("default");
let certificate = "";

before(async () => {
  const subject = ["-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"];
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-days", "1", ...subject, "-keyout", join(certs, "key.pem"), "-out", join(certs, "cert.pem")], { stdio: "ignore" });
  certificate = readFileSync(join(certs, "cert.pem"), "utf8");
  const settings = ["MP_SMTP_TLS_CERT=/certs/cert.pem", "MP_SMTP_TLS_KEY=/certs/key.pem", "MP_SMTP_REQUIRE_STARTTLS=true", `MP_SMTP_AUTH=${account.username}:${account.password}`];
  const ports = ["--publish", `127.0.0.1:${SMTP_PORT}:1025`, "--publish", `127.0.0.1:${API_PORT}:8025`];
  execFileSync("podman", ["run", "--detach", "--rm", "--name", CONTAINER, ...ports, "--volume", `${certs}:/certs:ro`, ...settings.flatMap((setting) => ["--env", setting]), MAILPIT], { stdio: "ignore" });
  await waitUntilUp(`${API}/info`);
});

after(() => {
  execFileSync("podman", ["rm", "--force", "--ignore", CONTAINER], { stdio: "ignore" });
  rmSync(certs, { recursive: true, force: true });
  trustOnly([]);
});

describe("sending email over SMTP", () => {
  it("sends the HTML, its plain-text copy and the images it shows, over STARTTLS once signed in", async () => {
    trustOnly([certificate]);
    const logo = { cid: "logo@mayfly", filename: "mayfly.png", content: new Uint8Array([137, 80, 78, 71]) };

    await send(account, { from: "owner@mayfly.test", to: "ana@mayfly.test", subject: "Your sign-in for my Mayfly apps", text: "Password: six-words", html: '<img src="cid:logo@mayfly"><p>Password: six-words</p>', images: [logo] });

    const received = (await (await fetch(`${API}/message/latest`)).json()) as Received;
    assert.equal(received.Subject, "Your sign-in for my Mayfly apps");
    assert.equal(received.Text.trim(), "Password: six-words");
    assert.match(received.HTML, /<img src="cid:logo@mayfly">/);
    assert.deepEqual(
      received.Inline.map(({ FileName, ContentID }) => ({ FileName, ContentID })),
      [{ FileName: "mayfly.png", ContentID: "logo@mayfly" }],
    );
  });

  it("checks an account by signing in, and fails with the server's reason for a wrong password", async () => {
    trustOnly([certificate]);

    await verify(account);
    await assert.rejects(verify({ ...account, password: "wrong" }), /Invalid login/);
  });

  it("won't sign in to a server whose certificate the system doesn't trust", async () => {
    trustOnly([]);

    await assert.rejects(verify(account), /self-signed certificate/);
  });

  it("won't send the password to a server that doesn't offer TLS", async () => {
    const heard = await whilePlainServerListens(() => assert.rejects(verify({ ...account, host: "127.0.0.1", port: PLAIN_PORT }), /STARTTLS/));

    assert.ok(heard.includes("STARTTLS"));
    assert.ok(!heard.some((line) => line.startsWith("AUTH")));
  });
});

interface Received {
  readonly Subject: string;
  readonly Text: string;
  readonly HTML: string;
  readonly Inline: readonly { readonly FileName: string; readonly ContentID: string }[];
}

/** Has Node trust the system's certificate authorities and these, for every TLS connection it makes from now on. */
function trustOnly(extra: readonly string[]): void {
  tls.setDefaultCACertificates([...SYSTEM_AUTHORITIES, ...extra]);
}

/** Runs a server that speaks SMTP but can't switch to TLS, while the check runs. Returns every line it heard. */
async function whilePlainServerListens(check: () => Promise<void>): Promise<string[]> {
  const heard: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.write("220 plain.test ESMTP\r\n");
    socket.on("data", (chunk) => {
      for (const line of chunk.toString().split("\r\n").filter(Boolean)) {
        heard.push(line);
        socket.write(line.startsWith("EHLO") ? "250-plain.test\r\n250 AUTH PLAIN LOGIN\r\n" : "502 5.5.1 Not implemented\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(PLAIN_PORT, "127.0.0.1", resolve));
  try {
    await check();
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
  return heard;
}
