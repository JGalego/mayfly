import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ToUi } from "./messages.ts";
import { openPages } from "./pages.ts";

const created: ToUi = { type: "created", name: "lunch" };

describe("the pages open on Mayfly", () => {
  it("all hear what the controller says", async () => {
    const pages = openPages();
    const tab: ToUi[] = [];
    const phone: ToUi[] = [];
    pages.open((message) => tab.push(message));
    pages.open((message) => phone.push(message));

    await pages.post(created);

    assert.deepEqual([tab, phone], [[created], [created]]);
  });

  it("hear nothing more once closed", async () => {
    const pages = openPages();
    const tab: ToUi[] = [];
    const close = pages.open((message) => tab.push(message));

    close();
    await pages.post(created);

    assert.deepEqual(tab, []);
  });
});
