<div align="center">

<img src="assets/logo.svg" alt="Mayfly at sunset" width="160">

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

Describe a small web app. Mayfly builds it and runs it locally in Podman behind sign-in. The model writes the app's routes; Mayfly supplies authentication, health checks, logs and container settings.

![Mayfly writes a lunch-splitting app, tries it, repairs it and runs it, then changes it, answers a question about it, and shows its history, code and usage](assets/demo.gif)

## Use it

### Prerequisites

- [Podman Desktop](https://podman-desktop.io/) with Podman 5 or later running.
- [OpenAI](https://platform.openai.com/api-keys) or another OpenAI-compatible provider.

### Steps

1. In Podman Desktop, open **Extensions**, choose **Install custom…**, and enter `ghcr.io/jgalego/mayfly-extension:main`.
2. Open **Mayfly → Settings → Models**. The default is OpenAI's `gpt-6.2-sol`. Add a key or choose another provider and model. Podman Desktop stores the key, and Mayfly sends it only to the endpoint it was saved for. Your requests, their attachments and your apps' code go to that provider, and `/fix` sends the errors an app logged, which can hold what its users typed.
3. Choose **New app** and describe what you need. You can attach images, such as a mockup, and text files with data (`.txt`, `.md`, `.csv`, `.tsv`, `.json`): use the paperclip, or paste or drop them. After deployment, sign in with the email and password under **Sign-in details**, next to **Open app**.
4. Ask for changes in the app's conversation. A successful update replaces the previous version at the same address. Type `/` for commands: `/ask` a question without changing the app, `/fix` the errors it logged, `/retry` your last request, `/undo` the last deploy, `/start` it again after it stopped, or switch its `/model`, `/rename` it or `/remove` it.

The status bar shows app status and token usage. **Settings → General → Enable developer mode** adds the code, available model reasoning, version history, logs and usage reports. You can save an edit from any version without deploying it, or deploy a version that passed its trial.

### Open apps from your phone

Your phone can open the apps too, over HTTPS through [Tailscale](https://tailscale.com), without exposing them to your network or the internet. The apps keep their localhost address on the computer.

1. Install Tailscale on the computer and on your phone, signed in to the same account. On Windows, install it on Windows itself, not inside WSL.
2. In Tailscale's admin console, open **DNS**, make sure MagicDNS is on, and choose **Enable HTTPS**. This puts the computer's Tailscale name, such as `mayfly.tail1a2b.ts.net`, in public certificate logs. If that name says something about you, rename the computer first under **Machines → Edit machine name**.
3. In Mayfly, turn on **Settings → General → Open apps from my phone**.
4. In an app, choose **On your phone** and scan the QR code with your phone's camera. Sign in with the same email and password.

### Share apps with other people

Other people open your apps the way your phone does, with their own email and password.

1. Turn on phone access, as above.
2. In **Settings → People**, choose **Add user** for each person. Mayfly makes them a password and offers to email it to them.
3. In Tailscale's admin console, share this computer with them.
4. In an app, choose **Share** and tick who can open it. Mayfly offers to email them the app's link.

Mayfly sends these emails from your mail account once you add it under **Settings → People → Email**: its SMTP server, and an app password where your provider has them. The password stays in Podman Desktop's secret storage, and Mayfly sends it only over TLS, to that server, once its certificate checks out. Without an account, Mayfly drafts each email in your mail app for you to send.

Each person has a sign-in group of their own. Each app lets in only yours and those of the people it's shared with, which you choose in the app. Taking someone off an app, removing them, or resetting their password restarts the apps involved and ends their sessions there. You stay signed in. Apps see who is signed in, so an app can treat you and others differently.

To remove Mayfly, `/remove` each app, which takes its pod and images with it, and then uninstall the extension. Sign-in and Mayfly's Podman network go with the last app. The runtime, Dex and oauth2-proxy images stay under **Images** until you remove them.

## Why not Dyad?

Applications like [Dyad](https://www.dyad.sh/) and [Lovable](https://lovable.dev/) generate the whole app, login and logging included, so those parts are only as good as the model was that day. In Mayfly the model writes the business logic and nothing else. Sign-in, health checks, logging and the container setup come from a fixed contract the model can't change, so every app runs the same way and you can hand it to someone else to run.

## The contract

A generated app is one TypeScript file, `routes.ts`, using [Hono](https://hono.dev/) on Node 24. The runtime listens on `$PORT`, serves `/healthz` and writes JSON logs to stdout. The app serves HTML at `/` with a link to `/oauth2/sign_out`. It has no server-side storage; data that must survive a restart can live in the browser.

[oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/) handles sign-in, checks the OIDC `groups` claim against the app's allowed roles and forwards identity in headers. It keeps the browser's cookies from the app, since browsers send every app on a host the cookies of all the others. [Dex](https://dexidp.io/) provides local OIDC. The app's port is not published; the proxy's is, on loopback only.

Mayfly deploys an OCI image and Kubernetes objects with `podman kube play`. Containers run as non-root with a read-only root filesystem, no Linux capabilities and CPU and memory limits. The proxy's ConfigMap sets the identity provider and allowed roles; credentials live in a Secret.

## The runtime image

The runtime image uses Node 24 on [Wolfi](https://github.com/wolfi-dev), built with [apko](https://github.com/chainguard-dev/apko) from locked packages, for amd64 and arm64. It has no shell or package manager. Its code is root-owned and read-only to the app. The runtime also sets security headers, limits request bodies to 1 MiB and handles shutdown.

`pixi run check-image` runs these checks locally and in CI:

| What | How |
|---|---|
| Containerfile: base pinned by digest, no `RUN` or `ADD`, numeric non-root user, exec-form entrypoint, no secrets, labels | [OPA](https://www.openpolicyagent.org/) via [conftest](https://www.conftest.dev/): [`containerfile.rego`](policy/containerfile.rego) |
| Reproducible image | Compare two build digests. Use Podman's `overlay` storage to match CI; `vfs` writes layer entries in a different order |
| Image: no shell, package manager or download tool, no setuid files, file ownership and permissions, no tests, 160 MB limit, no secrets in the environment, labels | OPA via conftest: [`image.rego`](policy/image.rego), checked against the image config and filesystem |
| High and critical vulnerabilities | [Grype](https://github.com/anchore/grype) |
| Policy tests | `conftest verify` |

Pre-commit runs [hadolint](https://github.com/hadolint/hadolint) separately.

CI publishes passing `main` builds to [`ghcr.io/jgalego/mayfly-runtime`](https://github.com/JGalego/mayfly/pkgs/container/mayfly-runtime) with commit SHA and `main` tags. It checks the rebuilt digest against the tested image, signs it with [Sigstore](https://www.sigstore.dev/) and attests its SBOM and build provenance. To verify:

```sh
gh attestation verify oci://ghcr.io/jgalego/mayfly-runtime:main --owner JGalego
cosign verify ghcr.io/jgalego/mayfly-runtime:main \
  --certificate-identity-regexp '^https://github.com/JGalego/mayfly/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## Architecture

The Podman Desktop extension calls a TypeScript engine. The core defines the app contract and builds pod specs. The engine uses adapters for state, identity, model calls and deployment.

```mermaid
flowchart LR
  shell["Podman Desktop extension"] --> api
  subgraph engine["Engine"]
    api["API"] --> core["Core<br/>contract · manifest → pod spec"]
    api --> ports["Ports<br/>state · identity · model · deployer"]
  end
  podman["Podman deployer"] -. implements .-> ports
  dex["Dex identity, on Podman"] -. implements .-> ports
  file["State in a private JSON file"] -. implements .-> ports
  model["OpenAI-compatible model provider<br/>your own key"] -. implements .-> ports
```

For each request, Mayfly builds and tests the model's code without network access or elevated privileges. The trial checks that the app starts, answers `/healthz` and serves an HTML home page with a sign-out link. Mayfly sends failures back to the model for up to three attempts in total.

```mermaid
flowchart LR
  d["Description<br/>or change request"] --> m["Model<br/>OpenAI-compatible"]
  m -->|"name + routes.ts"| b["Build<br/>runtime image + routes.ts"]
  b --> t["Trial run<br/>no network, no privileges"]
  t -->|"fails: its logs"| m
  t -->|"passes"| dep["Deploy behind sign-in"]
```

Each app has a light in the sidebar. It is orange while Mayfly works on the app. Otherwise it shows what Podman says, which Mayfly asks every 10 seconds.

```mermaid
stateDiagram-v2
  state "🟠 In the works" as working
  state "⚪ Never ran" as never
  state "◯ Starting" as starting
  state "🟢 Running" as running
  state "⭕ Unhealthy" as unhealthy
  state "🔴 Stopped" as stopped

  [*] --> working: you describe an app
  working --> never: no attempt passed
  working --> starting: deployed
  starting --> running: health check passes
  running --> unhealthy: health check fails
  unhealthy --> running: passes again
  unhealthy --> starting: Podman restarts it
  running --> stopped: it stops
  stopped --> starting: Start
```

Asking for a change turns any light orange, until a new version is deployed or the app is left as it was.

| Light | What it means | What to do |
|---|---|---|
| 🟠 In the works | Mayfly is writing, building, trying or deploying a version. The running version serves until the new one passes, and if none does, the app stays as it was. | Wait, or watch the conversation |
| ⚪ Never ran | No attempt at the app has passed yet. | `/retry`, or ask for it differently |
| ◯ Starting | Podman started the app, and its health check has not passed yet. | Wait a few seconds |
| 🟢 Running | The app is up and its health check passes. | |
| 🟡 Restarted | Running, after Podman restarted it at least once since its last deploy. | Read its logs, or `/fix` |
| ⭕ Unhealthy | Running, but its health check fails. After three failures in a row Podman restarts it, and it starts again. | Read its logs, or `/fix` |
| 🔴 Stopped | Not running, for example after the Podman machine stopped. | **Start**, or `/start`. To have Mayfly start them when Podman Desktop starts, turn on **Settings → General → Start stopped apps automatically**. |

Each app runs as one pod: oauth2-proxy in front, on 127.0.0.1, and the app behind it with no port on the host, so it only sees people who are signed in and allowed. With phone access on, a second proxy in the pod, the phone door, takes the requests Tailscale Serve forwards from the computer's Tailscale name over HTTPS. Both doors sign people in with the same Dex, which keeps them signed in across apps, and signing out of an app signs them out of Dex too.

![Mayfly on your computer: Podman Desktop, Podman, the app pods, Dex and Tailscale Serve](docs/architecture/architecture.png)

## Offerings

💻 **Individual** (being built). Runs on your own machine with Podman. Later you'll be able to deploy the same image and manifests to your own cloud.

🏢 **Enterprise** (not now). IT sets up a deployment target and the company IdP once, and after that anyone making an app gets a deploy button. A web control plane runs the same engine on a server and keeps the target, the IdP settings and each app's policy. An app made on a laptop moves to the company cluster unchanged, because it already ships as an image and Kubernetes manifests.

☁️ **SaaS** (later). Mayfly hosts apps for many customers. That's a harder security problem: running model-written code from many customers on shared machines needs strong isolation between them, abuse controls and billing. We won't start it until Individual and Enterprise work.

## Non-goals

- Login, user databases or sessions inside generated apps.
- Server-side persistence.
- Outbound network restrictions after deployment. The app shares a network with the proxy, which needs to reach the identity provider.
- More than one stack for generated apps.
- Mobile or WebAssembly targets.
- Container platforms other than Podman.

## Development

Development requires Node 24 and pre-commit. Image and integration checks also require Podman 5 or later and [pixi](https://pixi.sh).

```sh
nvm use
npm ci && npm ci --prefix runtime
pre-commit install
npm test
npm run typecheck
npm run build:runtime
npm run build:extension
pixi run check-image
npm run test:integration
```

`MAYFLY_LIVE=1 npm run test:integration` also calls the model configured in `.env` and may incur charges. The Tailscale test runs when Tailscale is signed in with HTTPS enabled. From WSL, point it at Windows' Tailscale with `MAYFLY_TAILSCALE="/mnt/c/Program Files/Tailscale/tailscale.exe"`.

To release, set the version in `extension/package.json` and push it to main. Once CI passes, tag that commit `vX.Y.Z` and push the tag: the release workflow publishes the tested extension image under the version.

## License

Copyright © 2026 João Galego.

Mayfly is licensed under the [GNU Affero General Public License v3.0 only](LICENSE). If you run a modified version for others over a network, you must offer them its source.

The runtime uses the [MIT License](runtime/LICENSE), so the apps you make are yours to use, share or sell on any terms.
