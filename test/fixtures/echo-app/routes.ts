import { Hono } from "hono";
import type { Env } from "./runtime/env.ts";

// Stands in for a generated app: shows who the runtime says is signed in.
export default new Hono<Env>().get("/", (c) => c.json(c.get("user")));
