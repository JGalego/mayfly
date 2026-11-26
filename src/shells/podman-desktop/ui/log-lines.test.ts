import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { atLeast, parseLogLine } from "./log-lines.ts";

const AT = "2026-11-26T15:04:05.123456789Z";

describe("parseLogLine", () => {
  it("reads an app's JSON line, keeping what it carried besides the message", () => {
    const line = parseLogLine(`${AT} {"time":"x","level":"warn","msg":"slow request","path":"/","ms":812}`);

    assert.deepEqual(line, { at: AT, level: "warn", text: "slow request", extra: '{"path":"/","ms":812}' });
  });

  it("reads Dex's key=value line", () => {
    const line = parseLogLine(`${AT} time=2026-11-26T15:04:05Z level=ERROR msg="failed to authenticate" err="bad password"`);

    assert.deepEqual(line, { at: AT, level: "error", text: "failed to authenticate", extra: "" });
  });

  it("shows anything else as it is", () => {
    assert.deepEqual(parseLogLine(`${AT} [2026/11/26] 127.0.0.1 GET / 200`), { at: AT, level: "info", text: "[2026/11/26] 127.0.0.1 GET / 200", extra: "" });
  });
});

describe("atLeast", () => {
  it("keeps lines as serious as wanted, or more", () => {
    assert.deepEqual(
      (["debug", "info", "warn", "error"] as const).map((level) => atLeast(level, "warn")),
      [false, false, true, true],
    );
  });
});
