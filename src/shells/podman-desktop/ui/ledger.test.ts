import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ModelCall } from "../../../engine/state.ts";
import { choicesOf, filtered, groupsOf, periodsOf, spanStart, startOf, ticksFor, unrecorded } from "./ledger.ts";

// Local times, so the tests mean the same in every time zone.
const now = new Date(2026, 10, 26, 18, 0);
const call = (at: Date, app: string | null, model: string, input: number): ModelCall => ({
  at: at.getTime(),
  app,
  provider: model.split(" · ")[0] ?? "",
  model,
  spent: { input, output: 10, thinking: 5 },
});
const calls: ModelCall[] = [
  call(new Date(2026, 9, 2, 9), "notes", "localhost:11434 · qwen3", 100),
  { ...call(new Date(2026, 10, 24, 10), "lunch", "OpenAI · gpt-6.2-sol", 1000), passed: false, took: 30_000 },
  { ...call(new Date(2026, 10, 26, 9), "lunch", "OpenAI · gpt-6.2-sol", 2000), passed: true, took: 10_000 },
  { ...call(new Date(2026, 10, 26, 11), null, "OpenAI · gpt-6.2-sol", 500), passed: false, took: 20_000 },
];
const ALL = { app: "", model: "", provider: "" };

describe("the token ledger", () => {
  it("adds up each day's calls, with empty days in between", () => {
    const days = periodsOf(calls, "day", spanStart({ grain: "day", periods: 3 }, calls, now), now);

    assert.deepEqual(
      days.map((day) => [day.start.getDate(), day.calls, day.spent.input]),
      [
        [24, 1, 1000],
        [25, 0, 0],
        [26, 2, 2500],
      ],
    );
  });

  it("counts each period's calls whose code passed and failed, leaving out those whose outcome is unknown, and the middle of their times", () => {
    const days = periodsOf(calls, "day", spanStart({ grain: "day", periods: 3 }, calls, now), now);

    assert.deepEqual(
      days.map((day) => [day.passed, day.failed, day.took]),
      [
        [0, 1, 30_000],
        [0, 0, null],
        [1, 1, 15_000],
      ],
    );
  });

  it("goes back to the month of the first call for all time", () => {
    const months = periodsOf(calls, "month", spanStart({ grain: "month", periods: "all" }, calls, now), now);

    assert.deepEqual(
      months.map((month) => [month.start.getMonth(), month.calls]),
      [
        [9, 1],
        [10, 3],
      ],
    );
  });

  it("starts weeks on Monday", () => {
    assert.deepEqual(startOf("week", now), new Date(2026, 10, 23));
    assert.deepEqual(startOf("week", new Date(2026, 10, 22, 23)), new Date(2026, 10, 16));
  });

  it("groups by model, provider or app, the most spent first, naming calls for apps never made", () => {
    assert.deepEqual(
      groupsOf(calls, "model", 0).map((group) => [group.name, group.calls]),
      [
        ["OpenAI · gpt-6.2-sol", 3],
        ["localhost:11434 · qwen3", 1],
      ],
    );
    assert.deepEqual(
      groupsOf(calls, "app", now.getTime() - 7 * 86_400_000).map((group) => group.name),
      ["lunch", "New apps that never got a name"],
    );
    assert.deepEqual(groupsOf(calls, "provider", 0)[1]?.spent, { input: 100, output: 10, thinking: 5 });
  });

  it("tells each group's passes and failures, and the middle of the times its calls took, when it knows them", () => {
    const [openai, qwen] = groupsOf(calls, "model", 0);

    assert.partialDeepStrictEqual(openai, { passed: 1, failed: 2, took: 20_000 });
    assert.partialDeepStrictEqual(qwen, { passed: 0, failed: 0, took: null });
  });

  it("keeps only the calls for the app, model and provider picked, where one is", () => {
    assert.equal(filtered(calls, ALL).length, 4);
    assert.deepEqual(filtered(calls, { ...ALL, app: "lunch" }).map((c) => c.spent.input), [1000, 2000]);
    assert.deepEqual(filtered(calls, { ...ALL, app: "New apps that never got a name" }).map((c) => c.spent.input), [500]);
    assert.deepEqual(filtered(calls, { ...ALL, provider: "localhost:11434", model: "OpenAI · gpt-6.2-sol" }), []);
  });

  it("offers each app, model and provider the calls name, in order", () => {
    assert.deepEqual(choicesOf(calls), {
      app: ["lunch", "New apps that never got a name", "notes"],
      model: ["localhost:11434 · qwen3", "OpenAI · gpt-6.2-sol"],
      provider: ["localhost:11434", "OpenAI"],
    });
  });

  it("says what was spent that it has no record of", () => {
    assert.deepEqual(unrecorded({ input: 4000, output: 40, thinking: 20 }, calls), { input: 400, output: 0, thinking: 0 });
  });

  it("puts round ticks on an axis that reaches past the largest value", () => {
    assert.deepEqual(ticksFor(9_100), [0, 2_500, 5_000, 7_500, 10_000]);
    assert.deepEqual(ticksFor(38), [0, 10, 20, 30, 40]);
    assert.deepEqual(ticksFor(0), [0]);
    assert.deepEqual(ticksFor(2, 1), [0, 1, 2], "counts step by whole numbers");
  });
});
