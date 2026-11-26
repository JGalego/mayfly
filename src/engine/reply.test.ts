import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseReply } from "./reply.ts";

const code = 'import { Hono } from "hono";\nexport default new Hono();';

describe("parseReply", () => {
  it("reads the app's name and its routes.ts", () => {
    const reply = `name: expense-splitter\n\`\`\`ts\n${code}\n\`\`\``;

    assert.deepEqual(parseReply(reply), { ok: true, name: "expense-splitter", code: { routes: `${code}\n` }, summary: "" });
  });

  it("reads what the model tells the person after the code", () => {
    const reply = `name: notes\n\`\`\`ts\n${code}\n\`\`\`\n\nKeeps your notes in this browser.\n`;

    assert.deepEqual(parseReply(reply), { ok: true, name: "notes", code: { routes: `${code}\n` }, summary: "Keeps your notes in this browser." });
  });

  it("ignores text before the code, which models add despite being asked not to", () => {
    const reply = `Here you go!\n\nname: notes\n\nSome words.\n\`\`\`typescript\n${code}\n\`\`\`\nEnjoy.`;

    assert.deepEqual(parseReply(reply), { ok: true, name: "notes", code: { routes: `${code}\n` }, summary: "Enjoy." });
  });

  it("reads edits to the code there is, and what follows them", () => {
    const reply = ["name: notes", "<<<<<<< SEARCH", "const a = 1;", "=======", "const a = 2;", ">>>>>>> REPLACE", "<<<<<<< SEARCH", "const b = 1;", "=======", ">>>>>>> REPLACE", "Changed a, dropped b."].join("\n");

    assert.deepEqual(parseReply(reply), {
      ok: true,
      name: "notes",
      code: {
        edits: [
          { search: "const a = 1;\n", replace: "const a = 2;\n" },
          { search: "const b = 1;\n", replace: "" },
        ],
      },
      summary: "Changed a, dropped b.",
    });
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
