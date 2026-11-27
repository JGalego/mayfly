import { Hono } from "hono";
import type { Env } from "./runtime/env.ts";

// Stands in for a generated app: shows who the runtime says is signed in, and any cookie the browser got through to it.
export default new Hono<Env>().get("/", (c) => c.json({ ...c.get("user"), cookie: c.req.header("cookie") ?? null }));
