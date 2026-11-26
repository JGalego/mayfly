import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withFiles } from "./prompt.ts";

const text = (name: string, contents: string) => ({ name, type: "", data: new TextEncoder().encode(contents) });
const image = (name: string) => ({ name, type: "image/png", data: new Uint8Array([1, 2, 3]) });

describe("withFiles", () => {
  it("leaves a request without files as it is", () => {
    assert.equal(withFiles("Split lunch bills", []), "Split lunch bills");
  });

  it("puts text files after the request, each named and fenced, more widely than anything inside them", () => {
    assert.equal(withFiles("Use these bills", [text("bills.csv", "who,amount\nana,12")]), "Use these bills\n\nThe person attached bills.csv:\n\n```\nwho,amount\nana,12\n```");
    assert.match(withFiles("Follow this", [text("spec.md", "```ts\nx\n```")]) as string, /\n````\n```ts\nx\n```\n````$/);
  });

  it("sends images as images, after the request, which names them", () => {
    assert.deepEqual(withFiles("Make it look like this", [image("mockup.png"), text("notes.txt", "blue")]), [
      { type: "text", text: "Make it look like this\n\nThe person attached notes.txt:\n\n```\nblue\n```\n\nThe person attached an image: mockup.png." },
      { type: "image", mediaType: "image/png", data: "AQID" },
    ]);
  });
});
