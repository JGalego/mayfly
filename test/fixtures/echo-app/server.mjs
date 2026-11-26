import { createServer } from "node:http";

// Stands in for a generated app: answers /healthz and echoes who the proxy says is signed in.
createServer((request, response) => {
  if (request.url === "/healthz") return response.end("ok");
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ email: request.headers["x-forwarded-email"], groups: request.headers["x-forwarded-groups"] }));
}).listen(Number(process.env.PORT));

process.on("SIGTERM", () => process.exit(0));
