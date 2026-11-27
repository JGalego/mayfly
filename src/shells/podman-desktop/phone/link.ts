import type { FromUi } from "../messages.ts";
import type { ToPhone } from "../phone-page.ts";

// In this page's own storage, which no app can read: its origin's port is the page's alone.
const TOKEN = "mayfly.phone";
const FIRST_WAIT_MS = 1000;
const MOST_WAIT_MS = 15_000;

/** Whether the phone hears the computer: trying to, yes, not for now, or never again until it pairs. */
export type LinkStatus = "connecting" | "online" | "offline" | "unpaired";

export interface LinkPorts {
  readonly fetch: typeof fetch;
  readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}

export interface Link {
  /** Sends a message to the computer. Throws, saying why, when the computer doesn't take it. */
  send(message: FromUi): Promise<void>;
  /** Connects again now, as when the phone wakes: a stream that slept may be dead without saying so. */
  wake(): void;
}

/** Trades the code from the computer's QR code for this phone's token, and keeps the token. */
export async function pair(code: string, { fetch, storage }: LinkPorts): Promise<void> {
  const response = await fetch("/pair", { method: "POST", body: JSON.stringify({ code }) });
  const { token, error } = (await response.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!response.ok || token === undefined) throw new Error(error ?? "Mayfly couldn't pair this phone. Show a new code on the computer.");
  storage.setItem(TOKEN, token);
}

export function isPaired({ storage }: LinkPorts): boolean {
  return storage.getItem(TOKEN) !== null;
}

/** Hears the computer's messages for as long as the page is open, connecting again whenever the stream drops. */
export function openLink(ports: LinkPorts, hear: (message: ToPhone) => void, status: (status: LinkStatus) => void): Link {
  let stop = new AbortController();
  let wakeUp = (): void => stop.abort();
  const authorization = (): string => `Bearer ${ports.storage.getItem(TOKEN) ?? ""}`;

  const listen = async (): Promise<void> => {
    status("connecting");
    for (let attempt = 0; ; attempt++) {
      stop = new AbortController();
      const ended = await follow(stop.signal);
      if (ended === "unpaired") {
        ports.storage.removeItem(TOKEN);
        return status("unpaired");
      }
      if (ended === "heard") attempt = 0;
      if (!stop.signal.aborted) status("offline");
      if (!stop.signal.aborted) await pause(waitBefore(attempt), (wake) => (wakeUp = wake));
      wakeUp = () => stop.abort();
    }
  };

  const follow = async (signal: AbortSignal): Promise<"unpaired" | "heard" | "unheard"> => {
    try {
      const response = await ports.fetch("/events", { headers: { authorization: authorization() }, cache: "no-store", signal });
      if (response.status === 401) return "unpaired";
      if (!response.ok || response.body === null) return "unheard";
      status("online");
      const split = lineSplitter((line) => hear(JSON.parse(line) as ToPhone));
      // A reader, not for await: Safari can't iterate a stream.
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      for (let read = await reader.read(); !read.done; read = await reader.read()) split(read.value);
      return "heard";
    } catch {
      return "unheard";
    }
  };

  void listen();
  return {
    async send(message) {
      const response = await ports.fetch("/messages", { method: "POST", headers: { authorization: authorization(), "content-type": "application/json" }, body: JSON.stringify(message) });
      if (!response.ok) throw new Error(REFUSALS[response.status] ?? "Mayfly didn't get that. Try again.");
    },
    wake: () => wakeUp(),
  };
}

const REFUSALS: Readonly<Record<number, string>> = {
  401: "This phone isn't paired anymore. Scan the code in Mayfly's Settings on the computer.",
  403: "Do that in Mayfly on the computer.",
  413: "Those photos and files are too big to send together. Send fewer at a time.",
};

/** Splits text that arrives in pieces into whole lines, keeping the start of a line until the rest arrives. */
export function lineSplitter(onLine: (line: string) => void): (text: string) => void {
  let partial = "";
  return (text) => {
    const lines = (partial + text).split("\n");
    partial = lines.pop() ?? "";
    for (const line of lines) if (line !== "") onLine(line);
  };
}

/** How long to wait before connecting again, doubling with each attempt that didn't reach the computer. */
export function waitBefore(attempt: number): number {
  return Math.min(FIRST_WAIT_MS * 2 ** attempt, MOST_WAIT_MS);
}

function pause(ms: number, onWake: (wake: () => void) => void): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    onWake(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
