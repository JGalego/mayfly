<div align="center">

<img src="assets/logo.svg" alt="Mayfly logo: a mayfly against a setting sun" width="160">

<h1>Mayfly</h1>

<p><em>Here for a day, built to stay.</em></p>

<p>
<img alt="Status: early" src="https://img.shields.io/badge/status-early-FF9A52?style=flat-square">
<a href="https://nodejs.org"><img alt="Node 24 or later" src="https://img.shields.io/badge/node-%3E%3D24-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white"></a>
<a href="https://www.typescriptlang.org"><img alt="TypeScript, strict" src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white"></a>
<a href="https://podman.io"><img alt="Runs on Podman" src="https://img.shields.io/badge/runs%20on-Podman-892CA0?style=flat-square&logo=podman&logoColor=white"></a>
<a href="https://hono.dev"><img alt="Apps: Hono on Node" src="https://img.shields.io/badge/apps-Hono%20on%20Node-E36002?style=flat-square&logo=hono&logoColor=white"></a>
<a href="https://oauth2-proxy.github.io/oauth2-proxy/"><img alt="Sign-in: OIDC" src="https://img.shields.io/badge/sign--in-OIDC-F78C40?style=flat-square&logo=openid&logoColor=white"></a>
</p>

<p>
<a href="https://en.wikipedia.org/wiki/Mayfly"><img alt="Order: Ephemeroptera" src="https://img.shields.io/badge/order-Ephemeroptera-2A1E3F?style=flat-square"></a>
<img alt="Adult lifespan: about a day" src="https://img.shields.io/badge/adult%20lifespan-~1%20day-E2475E?style=flat-square">
<img alt="Login code written by the model: 0 lines" src="https://img.shields.io/badge/login%20code%20by%20the%20model-0%20lines-2A1E3F?style=flat-square">
<img alt="Root: nope" src="https://img.shields.io/badge/root-nope-E2475E?style=flat-square">
</p>

</div>

Describe a small app for a short or routine task. Mayfly builds it and runs it on your machine, behind sign-in, with health checks and JSON logs. The model writes none of those parts.

## Why not Dyad?

[Dyad](https://www.dyad.sh/) and [Lovable](https://lovable.dev/) generate the whole app, including login and logging, so those parts are only as good as the model is that day. Mayfly moves them into a fixed contract that the model cannot weaken, and the model writes business logic only. Every app is production-shaped by construction and can be handed to someone else to run.

## The contract

A generated app:

- is an HTTP service on `$PORT`, configured only through environment variables;
- is stateless, with SQLite locally at most;
- answers `/healthz`;
- logs JSON to stdout;
- never implements login. An OIDC proxy ([oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/)) in front of it authenticates and passes identity to it in trusted headers. Locally, a development IdP stands in for a real one;
- is authorized by role. A policy file outside the app lists the OIDC roles allowed in, and the proxy enforces the list;
- ships as an OCI image plus Kubernetes manifests that `podman kube play` runs;
- is TypeScript on Node with Hono, like every other app.

Every container runs as a non-root user with all capabilities dropped, a read-only root filesystem and CPU and memory limits. Only the proxy is published, and only on loopback.

## Architecture

```mermaid
flowchart LR
  shell["Podman Desktop extension"] --> api
  subgraph engine["Engine: headless TypeScript library"]
    api["API"] --> core["Core<br/>contract · manifest → pod spec · expiry"]
    api --> ports["Ports<br/>state · identity · model · deployer"]
  end
  podman["Podman deployer"] -. implements .-> ports
  model["OpenAI-compatible model provider<br/>your own key"] -. implements .-> ports
```

Each app runs as one pod:

```mermaid
flowchart LR
  browser(["Browser"]) -->|"127.0.0.1 only"| proxy
  subgraph pod["Pod: mayfly-app"]
    proxy["oauth2-proxy<br/>sign-in · policy roles"] -->|"identity headers"| app["Generated app<br/>business logic only"]
  end
  proxy <-->|"OIDC"| idp["Dev IdP"]
```

## Offerings

💻 **Individual** (being built). Local-first, on your own Podman. Power users can later deploy the same image and manifests to their own cloud.

🏢 **Enterprise** (not now). IT configures a deployment target and the company IdP once, and creators get a deploy button. The engine and the contract stay the same. A web control plane holds the target, the IdP configuration and each app's policy, and runs the engine on a server. Apps move from a laptop to the company cluster without rewrites because they were cluster-shaped from the start.

☁️ **SaaS** (later). Mayfly hosts apps for many customers. This is a different security problem: running untrusted, model-written code for many tenants on shared infrastructure needs strong tenant isolation, abuse controls and billing. Out of scope until Individual and Enterprise work.

## Non-goals

- Login, user databases or sessions inside generated apps.
- Stateful apps in v1.
- More than one stack for generated apps.
- Mobile or WebAssembly targets.
- Container platforms other than Podman, for now. The engine doesn't depend on Podman, so Docker Desktop and Rancher Desktop can come later as new deployers and shells.

## Development

```sh
nvm use            # Node 24
npm install
npm test
npm run typecheck
```
