import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { failure, withInstallDirs } from "./cli.ts";

describe("finding podman", () => {
  it("adds Podman's Windows install folders, for everyone and for this user, to the PATH Windows spells as Path", () => {
    const env = withInstallDirs({ Path: "C:\\Windows", LOCALAPPDATA: "C:\\Users\\ana\\AppData\\Local" }, "win32");

    assert.equal(env.Path, "C:\\Windows;C:\\Program Files\\RedHat\\Podman;C:\\Users\\ana\\AppData\\Local\\Programs\\Podman");
  });

  it("adds the macOS install folders after the person's own PATH", () => {
    const env = withInstallDirs({ PATH: "/usr/bin" }, "darwin");

    assert.match(env.PATH ?? "", /^\/usr\/bin:\/opt\/podman\/bin:/);
  });

  it("leaves Linux alone, where podman comes from the package manager", () => {
    assert.deepEqual(withInstallDirs({ PATH: "/usr/bin" }, "linux"), { PATH: "/usr/bin" });
  });
});

describe("podman's errors", () => {
  it("says which port another program holds, as rootless Podman and Podman machines report it", () => {
    for (const stderr of [
      "Error: starting container 2569: rootlessport listen tcp 127.0.0.1:5556: bind: address already in use",
      "Error: failed to expose ports via proxy: listen tcp 127.0.0.1:8100: bind: Only one usage of each socket address (protocol/network address/port) is normally permitted.",
    ]) {
      assert.match(failure(["kube", "play"], stderr).message, /^Port (5556|8100) on this computer is in use by another program\./);
    }
  });

  it("says to start Podman's machine when Podman can't reach it", () => {
    const stderr = "Cannot connect to Podman. Please verify your connection to the Linux system using `podman system connection list`, or try `podman machine init` and `podman machine start` to manage a new Linux VM\nError: unable to connect to Podman socket: failed to connect: dial tcp 127.0.0.1:59825: connectex: No connection could be made because the target machine actively refused it.";

    assert.equal(failure(["ps"], stderr).message, "Podman's machine isn't running. Start it in Podman Desktop's Dashboard, then try again.");
  });

  it("passes any other error on as Podman gave it", () => {
    assert.equal(failure(["pod", "start", "x"], "Error: no pod with name or ID x found\n").message, "podman pod start x failed: Error: no pod with name or ID x found");
  });
});
