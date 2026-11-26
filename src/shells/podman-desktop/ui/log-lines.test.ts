import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { atLeast, matches, parseLogLine } from "./log-lines.ts";

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

describe("matches", () => {
  const line = { at: "2026-11-26T15:00:00Z", level: "warn" as const, text: "Slow request", extra: '{"path":"/bills"}' };
  const anything = { level: "debug" as const, since: 0, text: "" };

  it("keeps a line as serious as wanted, recent enough, and holding the words looked for", () => {
    assert.equal(matches(line, { ...anything, level: "warn", since: Date.parse("2026-11-26T14:00:00Z"), text: "/BILLS" }), true);
  });

  it("drops a line less serious, older, or without the words", () => {
    assert.equal(matches(line, { ...anything, level: "error" }), false);
    assert.equal(matches(line, { ...anything, since: Date.parse("2026-11-26T16:00:00Z") }), false);
    assert.equal(matches(line, { ...anything, text: "crash" }), false);
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
