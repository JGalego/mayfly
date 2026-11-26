import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { kindOf, problemWithFiles } from "./attachments.ts";

const file = (name: string, type: string, size = 10) => ({ name, type, data: new Uint8Array(size).fill(65) });

describe("attachments", () => {
  it("knows images by their type and text files by their name's ending", () => {
    assert.equal(kindOf(file("mockup.png", "image/png")), "image");
    assert.equal(kindOf(file("photo.JPG", "image/jpeg")), "image");
    assert.equal(kindOf(file("bills.csv", "")), "text");
    assert.equal(kindOf(file("Notes.MD", "application/octet-stream")), "text");
    assert.equal(kindOf(file("logo.svg", "image/svg+xml")), undefined);
    assert.equal(kindOf(file("report.pdf", "application/pdf")), undefined);
  });

  it("takes up to four images of up to 5 MB and text files of up to 100 KB, and nothing else", () => {
    assert.equal(problemWithFiles([file("a.png", "image/png"), file("b.csv", "")]), undefined);
    assert.match(problemWithFiles(Array.from({ length: 5 }, (_, n) => file(`${n}.png`, "image/png"))) ?? "", /at most 4 files/);
    assert.match(problemWithFiles([file("big.png", "image/png", 5 * 1024 * 1024 + 1)]) ?? "", /big\.png is larger than 5 MB/);
    assert.match(problemWithFiles([file("big.csv", "", 100 * 1024 + 1)]) ?? "", /big\.csv is larger than 100 KB/);
    assert.match(problemWithFiles([file("report.pdf", "application/pdf")]) ?? "", /Mayfly takes images .* and text files/);
  });

  it("takes only text files that are text", () => {
    const binary = { name: "data.json", type: "", data: new Uint8Array([0xff, 0xfe, 0x00]) };
    assert.match(problemWithFiles([binary]) ?? "", /data\.json is not text/);
  });
});
