import type { KubeObject } from "./kube.ts";

/** JSON is valid YAML, so each object is written as a JSON document. */
export function toKubeYaml(objects: readonly KubeObject[]): string {
  return objects.map((object) => JSON.stringify(object)).join("\n---\n");
}
