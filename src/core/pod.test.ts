import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPod } from "./pod.ts";
import type { Container, Pod } from "./kube.ts";

const pod = buildPod({
  manifest: { name: "expenses", image: "localhost/mayfly-expenses:1" },
  policy: { roles: ["finance", "admin"] },
  idp: { issuerUrl: "http://localhost:5556/dex", clientId: "mayfly-expenses" },
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

  it("configures the app through $PORT and nothing else", () => {
    assert.deepEqual(app.env, [{ name: "PORT", value: "8080" }]);
  });

  it("checks the app's health at /healthz on its own port", () => {
    assert.deepEqual(app.livenessProbe, { httpGet: { path: "/healthz", port: 8080 } });
  });

  it("forwards signed-in requests to the app over the pod's loopback", () => {
    assert.ok(proxy.args?.includes("--upstream=http://127.0.0.1:8080/"));
  });

  it("passes the signed-in user's identity to the app in headers", () => {
    assert.ok(proxy.args?.includes("--pass-user-headers=true"));
  });

  it("signs people in with the configured identity provider", () => {
    for (const arg of [
      "--provider=oidc",
      "--oidc-issuer-url=http://localhost:5556/dex",
      "--client-id=mayfly-expenses",
      "--redirect-url=http://localhost:8137/oauth2/callback",
    ]) {
      assert.ok(proxy.args?.includes(arg), arg);
    }
  });

  it("lets in only the roles the policy names, read from the roles claim", () => {
    const allowed = proxy.args?.filter((arg) => arg.startsWith("--allowed-group="));

    assert.deepEqual(allowed, ["--allowed-group=finance", "--allowed-group=admin"]);
    assert.ok(proxy.args?.includes("--oidc-groups-claim=roles"));
  });

  it("gives each app its own session cookie, since browsers share localhost cookies across ports", () => {
    assert.ok(proxy.args?.includes("--cookie-name=mayfly-expenses"));
  });

  it("takes the proxy's secrets from a Secret by reference, never inline", () => {
    for (const env of proxy.env ?? []) {
      assert.ok("valueFrom" in env, `${env.name} must come from a Secret`);
      assert.equal(env.valueFrom.secretKeyRef.name, "mayfly-expenses-auth");
    }
    assert.deepEqual(
      proxy.env?.map((env) => env.name),
      ["OAUTH2_PROXY_CLIENT_SECRET", "OAUTH2_PROXY_COOKIE_SECRET"],
    );
    assert.ok(!proxy.args?.some((arg) => /--(client|cookie)-secret=/.test(arg)));
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
