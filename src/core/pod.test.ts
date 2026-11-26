import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPod } from "./pod.ts";
import type { Container, Pod } from "./kube.ts";

const pod = buildPod({
  manifest: { name: "expenses", image: "localhost/mayfly-expenses:1" },
  hostPort: 8137,
});
const proxy = containerNamed(pod, "auth-proxy");
const app = containerNamed(pod, "app");

describe("the pod Mayfly runs for an app", () => {
  it("is named after the app, under Mayfly's prefix", () => {
    assert.equal(pod.metadata.name, "mayfly-expenses");
  });

  it("runs the app's image with a pinned auth proxy in front of it", () => {
    assert.deepEqual(
      pod.spec.containers.map((c) => c.name),
      ["auth-proxy", "app"],
    );
    assert.equal(app.image, "localhost/mayfly-expenses:1");
    assert.match(proxy.image, /oauth2-proxy:v\d+\.\d+\.\d+$/);
  });

  it("publishes only the proxy, and only on loopback", () => {
    const published = pod.spec.containers.flatMap((c) => c.ports ?? []);

    assert.deepEqual(published, [{ containerPort: 4180, hostPort: 8137, hostIP: "127.0.0.1" }]);
  });

  it("never pulls the app's image, which is built on this machine or loaded from a bundle", () => {
    assert.equal(app.imagePullPolicy, "IfNotPresent");
  });

  it("configures the app through $PORT and nothing else", () => {
    assert.deepEqual(app.env, [{ name: "PORT", value: "8080" }]);
  });

  it("checks the app's health by running the runtime's own check, which needs no shell or curl", () => {
    assert.deepEqual(app.livenessProbe?.exec.command, ["/usr/bin/node", "/app/runtime/health-check.ts"]);
  });

  it("gives the proxy no liveness probe, since its image has nothing to run one with", () => {
    assert.equal(proxy.livenessProbe, undefined);
  });

  it("forwards signed-in requests to the app over the pod's loopback", () => {
    assert.ok(proxy.args?.includes("--upstream=http://127.0.0.1:8080/"));
  });

  it("passes the signed-in user's identity to the app in headers", () => {
    assert.ok(proxy.args?.includes("--pass-user-headers=true"));
  });

  it("signs people in over OIDC and sends them back to this app's port", () => {
    assert.ok(proxy.args?.includes("--provider=oidc"));
    assert.ok(proxy.args?.includes("--redirect-url=http://localhost:8137/oauth2/callback"));
  });

  it("reads roles from the groups claim", () => {
    assert.ok(proxy.args?.includes("--oidc-groups-claim=groups"));
  });

  it("asks for consent once, not at every sign-in", () => {
    assert.ok(proxy.args?.includes("--approval-prompt=auto"));
  });

  it("takes the identity provider settings and allowed roles from the app's ConfigMap", () => {
    assert.deepEqual(proxy.envFrom, [{ configMapRef: { name: "mayfly-expenses-auth" } }]);
  });

  it("takes the proxy's secrets from the app's Secret by reference, never inline", () => {
    assert.deepEqual(secretRefs(proxy), {
      OAUTH2_PROXY_CLIENT_SECRET: "mayfly-expenses-auth/client-secret",
      OAUTH2_PROXY_COOKIE_SECRET: "mayfly-expenses-auth/cookie-secret",
    });
    assert.ok(proxy.env?.every((env) => "valueFrom" in env));
    assert.ok(!proxy.args?.some((arg) => /--(client|cookie)-secret=/.test(arg)));
  });

  it("gives each app its own session cookie, since browsers share localhost cookies across ports", () => {
    assert.ok(proxy.args?.includes("--cookie-name=mayfly-expenses"));
  });

  it("hardens every container the same way, whatever the manifest says", () => {
    for (const container of pod.spec.containers) {
      assert.deepEqual(container.securityContext, {
        runAsNonRoot: true,
        runAsUser: 65534,
        runAsGroup: 65534,
        allowPrivilegeEscalation: false,
        readOnlyRootFilesystem: true,
        capabilities: { drop: ["ALL"] },
      });
    }
  });

  it("caps every container's CPU and memory", () => {
    for (const container of pod.spec.containers) {
      assert.ok(container.resources.limits.cpu, `${container.name} cpu`);
      assert.ok(container.resources.limits.memory, `${container.name} memory`);
    }
  });
});

function containerNamed(pod: Pod, name: string): Container {
  const container = pod.spec.containers.find((c) => c.name === name);
  assert.ok(container, `no container named ${name}`);
  return container;
}

/** Each variable drawn from a Secret, as "secret/key". */
function secretRefs(container: Container): Record<string, string> {
  return Object.fromEntries(
    (container.env ?? []).flatMap((env) => {
      if (!("valueFrom" in env)) return [];
      const { name, key } = env.valueFrom.secretKeyRef;
      return [[env.name, `${name}/${key}`]];
    }),
  );
}
