import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { errorsIn } from "./log-errors.ts";

const at = (n: number): string => `2026-11-26T15:04:0${n}Z`;

describe("errorsIn", () => {
  it("keeps what the app logged as errors, without the times, each once, the latest last", () => {
    const lines = [
      `${at(1)} {"time":"a","level":"error","msg":"bills is not defined"}`,
      `${at(2)} {"time":"b","level":"info","msg":"GET / 200"}`,
      `${at(3)} {"time":"c","level":"fatal","msg":"out of memory"}`,
      `${at(4)} {"time":"d","level":"error","msg":"bills is not defined"}`,
      `${at(5)} Error: not JSON at all`,
    ];

    assert.deepEqual(errorsIn(lines), ['{"level":"fatal","msg":"out of memory"}', '{"level":"error","msg":"bills is not defined"}']);
  });

  it("keeps only the latest few", () => {
    const lines = Array.from({ length: 30 }, (_, n) => `${at(1)} {"level":"error","msg":"error ${n}"}`);

    assert.deepEqual(errorsIn(lines, 2), ['{"level":"error","msg":"error 28"}', '{"level":"error","msg":"error 29"}']);
  });
});
