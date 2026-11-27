import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildProxyConfigMap } from "./auth-proxy-container.ts";
import { buildDataClaim, buildPod } from "./pod.ts";
import type { Container, Pod } from "./kube.ts";

const END_SESSION = "http://localhost:5556/dex/logout";

const pod = buildPod({
  manifest: { name: "expenses", image: "localhost/mayfly-expenses:1" },
  hostPort: 8137,
  endSessionUrl: END_SESSION,
});
const proxy = containerNamed(pod, "auth-proxy");
const app = containerNamed(pod, "app");

const withPhone = buildPod({
  manifest: { name: "expenses", image: "localhost/mayfly-expenses:1" },
  hostPort: 8137,
  endSessionUrl: END_SESSION,
  phone: { host: "mayfly.tail1a2b.ts.net", loginUrl: "http://localhost:5556/dex/auth" },
});
const door = containerNamed(withPhone, "phone-door");

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

  it("configures the app through $PORT, and tells the runtime where its sign-out link goes", () => {
    assert.deepEqual(app.env?.map((env) => env.name), ["PORT", "MAYFLY_SIGN_OUT"]);
    assert.equal(valueOf(app, "PORT"), "8080");
    assert.deepEqual(Object.keys(JSON.parse(valueOf(app, "MAYFLY_SIGN_OUT"))), ["localhost:8137"]);
  });

  it("checks the app's health by running the runtime's own check, which needs no shell or curl", () => {
    assert.deepEqual(app.livenessProbe?.exec.command, ["/usr/bin/node", "/app/runtime/health-check.ts"]);
  });

  it("gives the proxy no liveness probe, since its image has nothing to run one with", () => {
    assert.equal(proxy.livenessProbe, undefined);
  });

  it("reads its settings file, read-only, from the app's proxy ConfigMap", () => {
    assert.ok(proxy.args?.includes("--alpha-config=/etc/oauth2-proxy/auth-proxy.yaml"));
    assert.deepEqual(proxy.volumeMounts, [{ name: "proxy-config", mountPath: "/etc/oauth2-proxy", readOnly: true }]);
    assert.deepEqual(pod.spec.volumes, [{ name: "proxy-config", configMap: { name: "mayfly-expenses-proxy" } }]);
  });

  it("sends people back to this app's port once they sign in", () => {
    assert.ok(proxy.args?.includes("--redirect-url=http://localhost:8137/.mayfly/callback"));
  });

  it("keeps the proxy's own pages apart from the app's, so the runtime answers the sign-out link", () => {
    assert.ok(proxy.args?.includes("--proxy-prefix=/.mayfly"));
  });

  it("lets the proxy send people on to the identity provider to end its session, and nowhere else", () => {
    assert.deepEqual(proxy.args?.filter((arg) => arg.startsWith("--whitelist-domain")), ["--whitelist-domain=localhost:5556"]);
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
    for (const container of [...pod.spec.containers, ...withPhone.spec.containers]) {
      const { capabilities, ...rest } = container.securityContext;
      assert.deepEqual(rest, { runAsNonRoot: true, runAsUser: 65534, runAsGroup: 65534, allowPrivilegeEscalation: false, readOnlyRootFilesystem: true });
      assert.deepEqual(capabilities.drop, ["ALL"]);
    }
  });

  it("keeps the proxies' ports for the proxies: below the app's port only they may listen, so the app can never answer in their place", () => {
    assert.deepEqual(pod.spec.securityContext, { sysctls: [{ name: "net.ipv4.ip_unprivileged_port_start", value: "8080" }] });
    assert.deepEqual(proxy.securityContext.capabilities.add, ["NET_BIND_SERVICE"]);
    assert.deepEqual(door.securityContext.capabilities.add, ["NET_BIND_SERVICE"]);
    assert.equal(app.securityContext.capabilities.add, undefined);
  });

  it("caps every container's CPU and memory", () => {
    for (const container of [...pod.spec.containers, ...withPhone.spec.containers]) {
      assert.ok(container.resources.limits.cpu, `${container.name} cpu`);
      assert.ok(container.resources.limits.memory, `${container.name} memory`);
    }
  });
});

describe("the pod of an app that keeps data", () => {
  const keeping = buildPod({ manifest: { name: "expenses", image: "localhost/mayfly-expenses:1" }, hostPort: 8137, endSessionUrl: END_SESSION, keepsData: true });

  it("mounts the app's own volume, writable, where the runtime keeps its store, and in no other container", () => {
    assert.deepEqual(containerNamed(keeping, "app").volumeMounts, [{ name: "data", mountPath: "/data", readOnly: false }]);
    assert.deepEqual(keeping.spec.volumes?.at(-1), { name: "data", persistentVolumeClaim: { claimName: "mayfly-expenses-data" } });
    assert.deepEqual(containerNamed(keeping, "auth-proxy"), proxy);
  });

  it("claims the volume for the user the app runs as, sized to what the store lets it hold", () => {
    const claim = buildDataClaim("expenses");

    assert.equal(claim.metadata.name, "mayfly-expenses-data");
    assert.deepEqual(claim.metadata.annotations, { "volume.podman.io/uid": "65534", "volume.podman.io/gid": "65534" });
    assert.deepEqual(claim.spec.resources.requests, { storage: "100M" });
  });

  it("gives an app that keeps nothing no volume, so its whole disk stays read-only", () => {
    assert.equal(app.volumeMounts, undefined);
    assert.ok(!pod.spec.volumes?.some((volume) => "persistentVolumeClaim" in volume));
  });
});

describe("the pod with phone access", () => {
  it("adds a phone door beside the localhost door, which stays exactly as it was", () => {
    assert.deepEqual(
      withPhone.spec.containers.map((c) => c.name),
      ["auth-proxy", "phone-door", "app"],
    );
    assert.deepEqual(containerNamed(withPhone, "auth-proxy"), proxy);
  });

  it("publishes the phone door on loopback only, 10000 above the app's port, for the private network to forward to", () => {
    assert.deepEqual(door.ports, [{ containerPort: 4181, hostPort: 18137, hostIP: "127.0.0.1" }]);
  });

  it("gives the phone door a settings file of its own, from the same ConfigMap", () => {
    assert.ok(door.args?.includes("--alpha-config=/etc/oauth2-proxy/phone-door.yaml"));
    assert.deepEqual(door.volumeMounts, proxy.volumeMounts);
    assert.deepEqual(withPhone.spec.volumes, pod.spec.volumes);
  });

  it("sends the phone back to the phone's side of the app's port once it signs in", () => {
    assert.ok(door.args?.includes("--redirect-url=https://mayfly.tail1a2b.ts.net:28137/.mayfly/callback"));
  });

  it("signs the phone out on the phone's address too, apart from the computer", () => {
    assert.deepEqual(door.args?.filter((arg) => arg.startsWith("--whitelist-domain")), ["--whitelist-domain=mayfly.tail1a2b.ts.net:25556"]);
    assert.deepEqual(Object.keys(JSON.parse(valueOf(containerNamed(withPhone, "app"), "MAYFLY_SIGN_OUT"))), ["localhost:8137", "mayfly.tail1a2b.ts.net:28137"]);
  });

  it("keeps the phone's session in a Secure cookie, since the phone only uses HTTPS", () => {
    assert.ok(door.args?.includes("--cookie-secure=true"));
  });

  it("admits the same people as the localhost door, from the same settings and secrets, to the same app", () => {
    assert.deepEqual(door.envFrom, proxy.envFrom);
    assert.deepEqual(secretRefs(door), secretRefs(proxy));
    for (const arg of ["--cookie-name=mayfly-expenses", "--proxy-prefix=/.mayfly", "--email-domain=*"]) {
      assert.ok(door.args?.includes(arg), arg);
    }
  });
});

describe("the proxy's ConfigMap", () => {
  it("holds a settings file for each door the pod has", () => {
    const computerOnly = buildProxyConfigMap("expenses");
    const both = buildProxyConfigMap("expenses", { host: "mayfly.tail1a2b.ts.net", loginUrl: "http://localhost:5556/dex/auth" });

    assert.equal(computerOnly.metadata.name, "mayfly-expenses-proxy");
    assert.deepEqual(Object.keys(computerOnly.data), ["auth-proxy.yaml"]);
    assert.deepEqual(Object.keys(both.data), ["auth-proxy.yaml", "phone-door.yaml"]);
    assert.equal(both.data["auth-proxy.yaml"], computerOnly.data["auth-proxy.yaml"]);
  });

  it("sends each door to sign in where its browser reaches the identity provider", () => {
    const both = buildProxyConfigMap("expenses", { host: "mayfly.tail1a2b.ts.net", loginUrl: "http://localhost:5556/dex/auth" });

    assert.match(both.data["auth-proxy.yaml"] ?? "", /bindAddress: 0\.0\.0\.0:4180\n[\s\S]*loginURL: '\$\{OAUTH2_PROXY_LOGIN_URL\}'/);
    assert.match(both.data["phone-door.yaml"] ?? "", /bindAddress: 0\.0\.0\.0:4181\n[\s\S]*loginURL: 'https:\/\/mayfly\.tail1a2b\.ts\.net:25556\/dex\/auth'/);
  });
});

function containerNamed(pod: Pod, name: string): Container {
  const container = pod.spec.containers.find((c) => c.name === name);
  assert.ok(container, `no container named ${name}`);
  return container;
}

function valueOf(container: Container, name: string): string {
  const env = container.env?.find((variable) => variable.name === name);
  assert.ok(env && "value" in env, `no value for ${name}`);
  return env.value;
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
