import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toKubeYaml } from "./kube-yaml.ts";
import type { KubeObject } from "./kube.ts";

describe("toKubeYaml", () => {
  it("writes one JSON document per object, which YAML readers accept", () => {
    const objects: KubeObject[] = [
      { apiVersion: "v1", kind: "ConfigMap", metadata: { name: "a" }, data: { K: "v" } },
      { apiVersion: "v1", kind: "Secret", metadata: { name: "b" }, stringData: { k: "s" } },
    ];

    const documents = toKubeYaml(objects).split("\n---\n");

    assert.deepEqual(documents.map((d) => JSON.parse(d)), objects);
  });
});
