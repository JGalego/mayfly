import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { KeyNeeded, listModels, modelSettingsFromEnv, openAiCompatibleModel } from "../../src/adapters/openai-compatible/openai-compatible-model.ts";

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
  let usage: object = { prompt_tokens: 12, completion_tokens: 2, total_tokens: 14 };
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk));
    request.on("end", () => {
      requests.push(JSON.parse(body) as Record<string, unknown>);
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const chunk of chunks(replying, usage, finish)) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
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
    assert.deepEqual(usage, { input: 12, output: 2, thinking: 0 });
    assert.deepEqual(requests.at(-1)?.stream_options, { include_usage: true });
  });

  it("sends an attached image as a data URL, beside the text", async () => {
    const model = openAiCompatibleModel({ baseUrl: await listening, apiKey: "sk-test", model: "m" });

    await model.complete("Be brief.", [{ role: "user", content: [{ type: "text", text: "Like this" }, { type: "image", mediaType: "image/png", data: "AQID" }] }]);

    assert.deepEqual((requests.at(-1)?.messages as unknown[] | undefined)?.[1], {
      role: "user",
      content: [{ type: "text", text: "Like this" }, { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } }],
    });
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

  it("counts the tokens spent thinking apart from the reply's, when the provider says how many", async () => {
    usage = { prompt_tokens: 12, completion_tokens: 50, total_tokens: 62, completion_tokens_details: { reasoning_tokens: 48 } };
    const model = openAiCompatibleModel({ baseUrl: await listening, apiKey: "sk-test", model: "m" });

    const completion = await model.complete("Be brief.", [{ role: "user", content: "Say ok." }]);

    assert.deepEqual(completion.usage, { input: 12, output: 2, thinking: 48 });
  });

  it("refuses a reply cut off at its token limit", async () => {
    finish = "length";
    const model = openAiCompatibleModel({ baseUrl: await listening, apiKey: "sk-test", model: "m" });

    await assert.rejects(model.complete("Be brief.", [{ role: "user", content: "Say ok." }]), /cut off/);
  });
});

describe("the OpenAI-compatible model, against a server that turns down every request", () => {
  const keys: (string | undefined)[] = [];
  let status = 401;
  // As OpenAI does, it quotes part of the key, which must never reach a person.
  const server = createServer((request, response) => {
    keys.push(request.headers.authorization);
    request.resume();
    // Retried at once, so a refusal the SDK retries does not hold the test up.
    response.writeHead(status, { "content-type": "application/json", "retry-after-ms": "0" });
    response.end(JSON.stringify({ error: { message: "Incorrect API key provided: sk-te**st." } }));
  });
  const listening = new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`)));
  after(() => server.close());
  const ask = (apiKey?: string) => async () => openAiCompatibleModel({ baseUrl: await listening, ...(apiKey === undefined ? {} : { apiKey }), model: "m" }).complete("Be brief.", [{ role: "user", content: "Say ok." }]);

  it("says a key is needed when none was given, and never in the provider's words", async () => {
    await assert.rejects(ask(), (error) => error instanceof KeyNeeded && !error.message.includes("sk-"));
    await assert.rejects(listModels({ baseUrl: await listening }), KeyNeeded);
  });

  it("says the provider refused the key it was given, without quoting it", async () => {
    await assert.rejects(ask("sk-test"), { message: "The provider refused the key." });
    assert.equal(keys.at(-1), "Bearer sk-test");
  });

  it("says plainly what any other refusal was", async () => {
    status = 404;
    await assert.rejects(ask("sk-test"), { message: "The provider has no model called m." });
    status = 429;
    await assert.rejects(ask("sk-test"), /limiting requests/);
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
function chunks(deltas: readonly object[], usage: object, finish: string): object[] {
  const chunk = (choices: object[], extra = {}) => ({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices, ...extra });
  return [
    ...deltas.map((delta) => chunk([{ index: 0, delta, finish_reason: null }])),
    chunk([{ index: 0, delta: {}, finish_reason: finish }]),
    chunk([], { usage }),
  ];
}
