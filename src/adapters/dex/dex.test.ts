import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { KubeObject, PersistentVolumeClaim, Pod, Secret } from "../../core/kube.ts";
import { buildDex } from "./dex.ts";

const KEY = "k".repeat(32);

describe("Dex as Mayfly runs it", () => {
  it("keeps its state in SQLite, on a volume that outlives the pod and belongs to the user Dex runs as", async () => {
    const objects = await buildDex({ users: [], clients: [], sessionKey: KEY });
    const claim = objects.find((o): o is PersistentVolumeClaim => o.kind === "PersistentVolumeClaim");
    const dex = podOf(objects).spec.containers[0];

    assert.deepEqual(configOf(objects).storage, { type: "sqlite3", config: { file: "/var/lib/mayfly-dex/dex.db" } });
    assert.deepEqual(claim?.metadata.annotations, { "volume.podman.io/uid": "65534", "volume.podman.io/gid": "65534" });
    assert.deepEqual(dex?.volumeMounts?.find((mount) => mount.mountPath === "/var/lib/mayfly-dex"), { name: "data", mountPath: "/var/lib/mayfly-dex", readOnly: false });
    assert.deepEqual(podOf(objects).spec.volumes?.find((volume) => volume.name === "data"), { name: "data", persistentVolumeClaim: { claimName: claim?.metadata.name } });
  });

  it("keeps people signed in to every app for a while, in an encrypted cookie", async () => {
    const objects = await buildDex({ users: [], clients: [], sessionKey: KEY });

    assert.deepEqual(configOf(objects).sessions, {
      absoluteLifetime: "720h",
      validIfNotUsedFor: "168h",
      rememberMeCheckedByDefault: true,
      cookieEncryptionKey: KEY,
      ssoSharedWithDefault: "all",
    });
    assert.deepEqual(podOf(objects).spec.containers[0]?.env, [{ name: "DEX_SESSIONS_ENABLED", value: "true" }]);
  });

  it("has no sessions without a key", async () => {
    const objects = await buildDex({ users: [], clients: [] });

    assert.equal(configOf(objects).sessions, undefined);
    assert.equal(podOf(objects).spec.containers[0]?.env, undefined);
  });
});

function podOf(objects: readonly KubeObject[]): Pod {
  const pod = objects.find((o): o is Pod => o.kind === "Pod");
  assert.ok(pod);
  return pod;
}

function configOf(objects: readonly KubeObject[]): Record<string, unknown> {
  const secret = objects.find((o): o is Secret => o.kind === "Secret");
  return JSON.parse(secret?.stringData["config.yaml"] ?? "{}") as Record<string, unknown>;
}
