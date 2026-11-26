import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { modelSettingsFromEnv, openAiCompatibleModel } from "../../src/adapters/openai-compatible/openai-compatible-model.ts";

/** The same thinking and reply of "ok", each way compatible servers stream thinking. */
const THINKING: Record<string, readonly object[]> = {
  "in reasoning_content, as DeepSeek and vLLM send it": [{ reasoning_content: "Say ok, " }, { reasoning_content: "then." }, { content: "o" }, { content: "k" }],
  "in reasoning, as OpenRouter sends it": [{ reasoning: "Say ok, " }, { reasoning: "then." }, { content: "o" }, { content: "k" }],
  "between <think> tags in the text": [{ content: "<think>Say ok, " }, { content: "then.</think>" }, { content: "o" }, { content: "k" }],
};

describe("the OpenAI-compatible model, against a server that streams like OpenAI's", () => {
  const requests: Record<string, unknown>[] = [];
  let finish = "stop";
  let replying: readonly object[] = [{ content: "o" }, { content: "k" }];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk));
    request.on("end", () => {
      requests.push(JSON.parse(body) as Record<string, unknown>);
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const chunk of chunks(replying, finish)) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      response.end("data: [DONE]\n\n");
    });
  });
  const listening = new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`)));
  after(() => server.close());

  it("passes on each piece of the reply as it arrives, and says what it cost", async () => {
    const model = openAiCompatibleModel({ baseUrl: await listening, apiKey: "sk-test", model: "m" });
    const pieces: string[] = [];

    const { text, thinking, usage } = await model.complete("Be brief.", [{ role: "user", content: "Say ok." }], { text: (piece) => pieces.push(piece) });

    assert.deepEqual(pieces, ["o", "k"]);
    assert.equal(text, "ok");
    assert.equal(thinking, "");
    assert.deepEqual(usage, { input: 12, output: 2 });
    assert.deepEqual(requests.at(-1)?.stream_options, { include_usage: true });
  });

  for (const [how, deltas] of Object.entries(THINKING)) {
    it(`passes on thinking sent ${how}, apart from the reply`, async () => {
      replying = deltas;
      const model = openAiCompatibleModel({ baseUrl: await listening, apiKey: "sk-test", model: "m" });
      const thoughts: string[] = [];

      const { text, thinking } = await model.complete("Be brief.", [{ role: "user", content: "Say ok." }], { thinking: (piece) => thoughts.push(piece) });

      assert.equal(text, "ok");
      assert.equal(thinking, "Say ok, then.");
      assert.equal(thoughts.join(""), thinking);
    });
  }

  it("refuses a reply cut off at its token limit", async () => {
    finish = "length";
    const model = openAiCompatibleModel({ baseUrl: await listening, apiKey: "sk-test", model: "m" });

    await assert.rejects(model.complete("Be brief.", [{ role: "user", content: "Say ok." }]), /cut off/);
  });
});

// Calls a real, paid model, so it runs only when asked: MAYFLY_LIVE=1 with the settings from .env.example.
describe("the OpenAI-compatible model, live", { skip: process.env.MAYFLY_LIVE !== "1" && "set MAYFLY_LIVE=1 to call the model" }, () => {
  it("streams its answer to a conversation under a system prompt, and says what it cost", async () => {
    const model = openAiCompatibleModel(modelSettingsFromEnv());

    const pieces: string[] = [];
    const { text, usage } = await model.complete("Reply with one word, in lowercase.", [{ role: "user", content: "Say ok." }], { text: (piece) => pieces.push(piece) });

    assert.match(text, /ok/);
    assert.equal(pieces.join(""), text);
    assert.ok(usage.input > 0 && usage.output > 0);
  });
});

/** Deltas in the chunks OpenAI streams, ending with the usage chunk `include_usage` asks for. */
function chunks(deltas: readonly object[], finish: string): object[] {
  const chunk = (choices: object[], extra = {}) => ({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices, ...extra });
  return [
    ...deltas.map((delta) => chunk([{ index: 0, delta, finish_reason: null }])),
    chunk([{ index: 0, delta: {}, finish_reason: finish }]),
    chunk([], { usage: { prompt_tokens: 12, completion_tokens: 2, total_tokens: 14 } }),
  ];
}
