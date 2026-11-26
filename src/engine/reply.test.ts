import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseReply } from "./reply.ts";

const code = 'import { Hono } from "hono";\nexport default new Hono();';

describe("parseReply", () => {
  it("reads the app's name and its routes.ts", () => {
    const reply = `name: expense-splitter\n\`\`\`ts\n${code}\n\`\`\``;

    assert.deepEqual(parseReply(reply), { ok: true, name: "expense-splitter", routes: `${code}\n` });
  });

  it("ignores text around the name and the code, which models add despite being asked not to", () => {
    const reply = `Here you go!\n\nname: notes\n\nSome words.\n\`\`\`typescript\n${code}\n\`\`\`\nEnjoy.`;

    assert.deepEqual(parseReply(reply), { ok: true, name: "notes", routes: `${code}\n` });
  });

  it("explains a missing or invalid name, so the model can fix it", () => {
    for (const reply of [`\`\`\`ts\n${code}\n\`\`\``, `name: Expense Splitter\n\`\`\`ts\n${code}\n\`\`\``]) {
      const parsed = parseReply(reply);
      assert.equal(parsed.ok, false);
      assert.match(parsed.ok ? "" : parsed.problem, /name/);
    }
  });

  it("explains a missing or unfinished code block", () => {
    for (const reply of ["name: notes", `name: notes\n\`\`\`ts\n${code}`]) {
      const parsed = parseReply(reply);
      assert.equal(parsed.ok, false);
      assert.match(parsed.ok ? "" : parsed.problem, /```ts/);
    }
  });
});
