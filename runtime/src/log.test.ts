import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { useJsonConsole } from "./log.ts";

afterEach(() => mock.restoreAll());

describe("useJsonConsole", () => {
  it("turns whatever generated code writes to the console into JSON lines on stdout", () => {
    const logged: string[] = [];
    mock.method(process.stdout, "write", (line: string) => logged.push(line));
    for (const method of ["log", "info", "warn", "error", "debug"] as const) mock.method(console, method);

    useJsonConsole();
    console.log("saved %d rows", 3);
    console.error("failed");

    assert.deepEqual(
      logged.map((line) => JSON.parse(line)).map(({ level, msg }) => ({ level, msg })),
      [
        { level: "info", msg: "saved 3 rows" },
        { level: "error", msg: "failed" },
      ],
    );
  });
});
