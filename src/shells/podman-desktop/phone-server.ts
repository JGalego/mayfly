import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join } from "node:path";
import type { FromUi, ToUi } from "./messages.ts";
import type { Pages } from "./pages.ts";
import { forPhone, phoneMayAsk } from "./phone-page.ts";

// Four 5 MB photos, the most a request takes, in base64, with room for the words.
const MAX_MESSAGE = 28 * 1024 * 1024;
const MAX_PAIRING = 1024;
const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; img-src 'self' data: blob:; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
};

export interface PageFile {
  readonly type: string;
  readonly body: Uint8Array;
}

export interface PhoneServerPorts {
  /** Takes a message as the controller takes one from Mayfly's tab. */
  readonly handle: (message: unknown) => Promise<void>;
  readonly pages: Pick<Pages, "open">;
  readonly phones: {
    /** Pairs the phone that brought the code, and returns the token it keeps. Throws, saying why, when the code doesn't work. */
    pair(code: string, name: string): Promise<string>;
    paired(token: string): Promise<boolean>;
  };
  /** One of the phone page's files, by name. */
  readonly file: (name: string) => Promise<PageFile | undefined>;
}

// The page's own kinds of file, and nothing else, such as its sources.
const PAGE_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

/** The phone page's files, from the folder the build puts them in. */
export function pageFiles(folder: string): PhoneServerPorts["file"] {
  return async (name) => {
    const type = PAGE_TYPES[extname(name)];
    if (type === undefined) return undefined;
    try {
      return { type, body: await readFile(join(folder, name)) };
    } catch {
      return undefined;
    }
  };
}

export interface PhoneServer {
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Serves the phone page on loopback, for Tailscale Serve to put on the private network. Any request may come from anyone
 * who reaches the port, so everything but the page's files and pairing needs a paired phone's token.
 */
export async function startPhoneServer(ports: PhoneServerPorts, candidates: readonly number[]): Promise<PhoneServer> {
  const server = createServer((request, response) => {
    answer(request, response, ports).catch(() => end(response, 500));
  });
  const port = await listenOnFirstFree(server, candidates);
  return {
    port,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        // The phones' event streams never end on their own.
        server.closeAllConnections();
      }),
  };
}

async function answer(request: IncomingMessage, response: ServerResponse, ports: PhoneServerPorts): Promise<void> {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
  const path = new URL(request.url ?? "/", "http://phone").pathname;
  const route = `${request.method} ${path}`;
  if (route === "POST /pair") return pair(request, response, ports);
  if (path === "/events" || path === "/messages") {
    const token = bearerToken(request);
    if (token === undefined || !(await ports.phones.paired(token))) return end(response, 401);
    if (route === "GET /events") return stream(token, request, response, ports);
    if (route === "POST /messages") return take(request, response, ports);
    return end(response, 405);
  }
  if (request.method === "GET") return serveFile(path, response, ports);
  return end(response, 405);
}

async function pair(request: IncomingMessage, response: ServerResponse, ports: PhoneServerPorts): Promise<void> {
  const { code } = ((await bodyOf(request, MAX_PAIRING, response)) ?? {}) as { code?: unknown };
  if (typeof code !== "string") return end(response, 400);
  try {
    json(response, 200, { token: await ports.phones.pair(code, phoneName(request.headers["user-agent"] ?? "")) });
  } catch (error) {
    json(response, 403, { error: error instanceof Error ? error.message : String(error) });
  }
}

// Each phone has its own stream, so the controller's one broadcast reaches it as it reaches Mayfly's tab.
async function stream(token: string, request: IncomingMessage, response: ServerResponse, ports: PhoneServerPorts): Promise<void> {
  response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" });
  const close = ports.pages.open(async (message) => {
    // The controller shows the state after every change, forgetting a phone included, so this is where a forgotten phone stops.
    if (message.type === "state" && !(await ports.phones.paired(token))) return void response.end();
    write(response, message);
  });
  response.on("close", close);
  // The state first, so a phone back from sleep catches up by connecting again.
  await ports.handle({ type: "ready" });
}

function write(response: ServerResponse, message: ToUi): void {
  const heard = forPhone(message);
  if (heard !== null && !response.writableEnded) response.write(`${JSON.stringify(heard)}\n`);
}

async function take(request: IncomingMessage, response: ServerResponse, ports: PhoneServerPorts): Promise<void> {
  const message = await bodyOf(request, MAX_MESSAGE, response);
  if (message === undefined) return;
  if (!isMessage(message)) return end(response, 400);
  if (!phoneMayAsk(message)) return end(response, 403);
  end(response, 202);
  // The work can take minutes: the phone follows it on its event stream.
  void ports.handle(message);
}

async function serveFile(path: string, response: ServerResponse, ports: PhoneServerPorts): Promise<void> {
  const name = path === "/" ? "index.html" : path.slice(1);
  // A plain file name, never a path out of the page's folder.
  const file = /^\w[\w.-]*$/.test(name) ? await ports.file(name) : undefined;
  if (file === undefined) return end(response, 404);
  response.writeHead(200, { "content-type": file.type, "cache-control": "no-cache" }).end(file.body);
}

function bearerToken(request: IncomingMessage): string | undefined {
  return /^Bearer ([\w-]+)$/.exec(request.headers.authorization ?? "")?.[1];
}

/** The body as JSON, or undefined once it has answered that the body is too big or not JSON. */
async function bodyOf(request: IncomingMessage, limit: number, response: ServerResponse): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) {
      end(response, 413);
      request.destroy();
      return undefined;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    end(response, 400);
    return undefined;
  }
}

function isMessage(value: unknown): value is FromUi {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

/** What kind of phone it is, as its browser says, to tell paired phones apart in Settings. */
function phoneName(userAgent: string): string {
  if (userAgent.includes("iPhone")) return "iPhone";
  if (userAgent.includes("iPad")) return "iPad";
  if (userAgent.includes("Android")) return "Android phone";
  return "Phone";
}

function json(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));
}

function end(response: ServerResponse, status: number): void {
  if (!response.headersSent) response.writeHead(status);
  response.end();
}

async function listenOnFirstFree(server: Server, candidates: readonly number[]): Promise<number> {
  for (const port of candidates) {
    const listening = await new Promise<boolean>((resolve) => {
      const taken = () => resolve(false);
      server.once("error", taken);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", taken);
        resolve(true);
      });
    });
    if (listening) return (server.address() as { port: number }).port;
  }
  throw new Error(`Ports \`${candidates.at(-1)}\` to \`${candidates[0]}\` are all in use, so the phone page can't start. Free one of them, then try again.`);
}
