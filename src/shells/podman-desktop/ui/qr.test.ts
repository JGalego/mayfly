import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { qrModules } from "./qr.ts";

describe("a QR code for the phone", () => {
  const { size, path } = qrModules("https://mayfly.tail1a2b.ts.net:18100/");

  it("draws one square per dark module, with a light border for scanners", () => {
    const squares: string[] = path.match(/M\d+ \d+h1v1h-1z/g) ?? [];

    assert.equal(squares.join(""), path);
    assert.ok(!squares.includes("M0 0h1v1h-1z"), "the corner is border");
    assert.ok(squares.includes("M2 2h1v1h-1z"), "the finder pattern starts inside the border");
    assert.ok(squares.every((square) => Number(square.split(" ")[0]?.slice(1)) < size));
  });
});
