import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { needsRedrawing, shrinkFor } from "./photos.ts";

const MB = 1024 * 1024;

describe("photos from the phone", () => {
  it("go as they are when Mayfly takes them", () => {
    assert.equal(needsRedrawing({ name: "sketch.jpg", type: "image/jpeg", size: 3 * MB }), false);
    assert.equal(needsRedrawing({ name: "notes.txt", type: "text/plain", size: 20 * MB }), false);
  });

  it("are drawn again as JPEG when too big, or of a kind the model can't see", () => {
    assert.equal(needsRedrawing({ name: "sketch.jpg", type: "image/jpeg", size: 12 * MB }), true);
    assert.equal(needsRedrawing({ name: "IMG_0001.HEIC", type: "image/heic", size: 2 * MB }), true);
  });

  it("shrink each side by the square root of how far over they are, and a little more, since size goes with area", () => {
    assert.equal(shrinkFor(5 * MB), 1);
    assert.equal(shrinkFor(20 * MB), 0.45);
  });
});
