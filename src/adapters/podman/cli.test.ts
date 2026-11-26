import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withInstallDirs } from "./cli.ts";

describe("finding podman", () => {
  it("adds Podman's Windows install folder to the PATH Windows spells as Path", () => {
    const env = withInstallDirs({ Path: "C:\\Windows" }, "win32");

    assert.deepEqual(env, { Path: "C:\\Windows;C:\\Program Files\\RedHat\\Podman" });
  });

  it("adds the macOS install folders after the person's own PATH", () => {
    const env = withInstallDirs({ PATH: "/usr/bin" }, "darwin");

    assert.match(env.PATH ?? "", /^\/usr\/bin:\/opt\/podman\/bin:/);
  });

  it("leaves Linux alone, where podman comes from the package manager", () => {
    assert.deepEqual(withInstallDirs({ PATH: "/usr/bin" }, "linux"), { PATH: "/usr/bin" });
  });
});
