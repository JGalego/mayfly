// Keeps the page's own files, so it still opens when the computer doesn't answer, and says it can't reach Mayfly.
// Only the page: what the phone hears and sends always goes to the computer.

interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchEvent extends ExtendableEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}

interface Worker {
  addEventListener(type: "install", listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEvent) => void): void;
}

const CACHE = "mayfly-phone";
const PAGE = ["/", "/phone.js", "/ui.css", "/phone.css", "/logo.svg", "/icon.png", "/manifest.webmanifest"];
const worker = self as unknown as Worker;

worker.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PAGE))));

worker.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method === "GET" && PAGE.includes(new URL(request.url).pathname)) event.respondWith(fresh(request));
});

// The computer's copy first, so an update shows at once, and the kept one when the computer doesn't answer.
async function fresh(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    if (!response.ok) return (await caches.match(request)) ?? response;
    await (await caches.open(CACHE)).put(request, response.clone());
    return response;
  } catch {
    return (await caches.match(request)) ?? Response.error();
  }
}
