# Mayfly

Describe a small app for a short or routine task, and Mayfly builds it and runs
it on your machine. Each app comes with sign-in, role-based access, health checks
and JSON logs. The model writes none of those parts.

**Status:** early. The core contract exists. The Podman deployer and the Podman
Desktop extension come next.

## Why not Dyad?

[Dyad](https://www.dyad.sh/) and Lovable generate the whole app, including the
login, the access checks and the logging. Those parts are only as good as the
model and the prompt that day. Mayfly takes them out of generated code and
puts them in a fixed contract that the model cannot weaken. The model writes
business logic only. So every app is production-shaped by construction: an OCI
image plus Kubernetes manifests, ready to hand to someone else and run on their
machine.

## The contract

Every generated app:

- is an HTTP service that listens on `$PORT` and is configured only through
  environment variables;
- is stateless: no database in v1, and SQLite locally at most;
- answers health checks at `/healthz`;
- logs JSON to stdout;
- **never implements login.** An OIDC proxy
  ([oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/)) runs in front
  of it and authenticates every request, and the app reads who the user is from
  trusted headers. Locally, a development identity provider stands in for a
  real one;
- has **coarse authorization:** a policy file outside the app lists the roles
  (taken from an OIDC claim) that may use it, and the proxy enforces that list;
- ships as an OCI image plus Kubernetes manifests that `podman kube play` can
  run;
- is written in one stack, TypeScript on Node with Hono, the same for every app.

Mayfly also hardens everything it runs. Containers never run as root, drop all
Linux capabilities, can't gain privileges, have a read-only root filesystem
and CPU and memory limits, and are published on loopback only.

## How it is built

A headless **engine**, a TypeScript library with a small API, does the work.
Its state storage, identity source, model provider and deployer are passed in
through small interfaces. Its **core** (manifest to pod spec, the contract,
expiry rules) imports no adapters. Thin **shells** put the engine in front of
people. The first shell is a Podman Desktop extension, the first deployer is
local Podman, and the default model provider is any OpenAI-compatible endpoint
called with your own key.

## Offerings

**Individual** (being built now). Local-first: apps run on your own Podman,
behind your own development identity provider. Power users can later deploy
the same image and manifests to their own cloud.

**Enterprise** (not now). IT configures a deployment target and the company
identity provider once, and creators get a deploy button. The engine and the
contract stay the same. What's new is a web control plane that holds the
target, the IdP configuration and each app's policy, and runs the engine on a
server instead of a laptop. Apps move from a laptop to the company cluster
without rewrites because they were cluster-shaped from the start.

**SaaS** (later). Mayfly hosts the apps for many customers. That's a
different security problem from the other two: it means running untrusted,
model-written code for many tenants on shared infrastructure. That needs
strong isolation between tenants, abuse controls and billing. None of it is in
scope until Individual and Enterprise work.

## Non-goals

- Login screens, user databases or session handling inside generated apps.
- Stateful apps (databases, queues, background workers) in v1.
- A choice of languages or frameworks for generated apps.
- Mobile or WebAssembly targets.
- Running other people's generated code on shared infrastructure (that's
  SaaS, later).
- Container platforms other than Podman for now. The engine does not depend on
  Podman, so Docker Desktop or Rancher Desktop can be added later as new
  deployers and shells.

## Development

Node 24 (see `.nvmrc`).

```sh
npm install
npm test            # node --test, TypeScript run directly by Node
npm run typecheck   # tsc --noEmit
```
