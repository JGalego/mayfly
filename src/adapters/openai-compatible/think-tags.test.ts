import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { thinkTags, type Parts } from "./think-tags.ts";

/** Reads the pieces in order and joins up what each part received. */
function split(...pieces: string[]): Parts {
  const tags = thinkTags();
  const parts = [...pieces.map((piece) => tags.read(piece)), tags.end()];
  return { thinking: parts.map((part) => part.thinking).join(""), text: parts.map((part) => part.text).join("") };
}

describe("think tags in a streamed reply", () => {
  it("separate the thinking a reply opens with from the reply", () => {
    assert.deepEqual(split("<think>Notes need a list.</think>\nname: notes"), { thinking: "Notes need a list.", text: "\nname: notes" });
  });

  it("are found when split across pieces, and after leading whitespace", () => {
    assert.deepEqual(split("\n<thi", "nk>a list", "</th", "ink>name: notes"), { thinking: "a list", text: "name: notes" });
  });

  it("pass the thinking on as it comes, holding back only what may be the closing tag", () => {
    const tags = thinkTags();

    assert.deepEqual(tags.read("<think>a li"), { thinking: "a li", text: "" });
    assert.deepEqual(tags.read("st</"), { thinking: "st", text: "" });
    assert.deepEqual(tags.read("p> is fine"), { thinking: "</p> is fine", text: "" });
  });

  it("leave a reply that does not open with them alone, even when it mentions them", () => {
    assert.deepEqual(split("name: notes\n", "<think>"), { thinking: "", text: "name: notes\n<think>" });
    assert.deepEqual(split("<"), { thinking: "", text: "<" });
  });

  it("count a reply cut off while thinking as thinking", () => {
    assert.deepEqual(split("<think>still going"), { thinking: "still going", text: "" });
  });
});
