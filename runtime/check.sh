#!/usr/bin/env bash
# Proves the runtime image meets the policies in policy/: the policies pass their own tests, the
# Containerfile follows them, two builds give the same digest, the built image follows them, and
# it has no known high or critical vulnerabilities. Run it with `pixi run check-image`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT
readonly IMAGE="localhost/mayfly-runtime:dev"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

step() { printf '\n== %s\n' "$1"; }

step "The policies pass their own tests"
conftest verify --policy "$ROOT/policy"

step "The Containerfile follows policy"
conftest test --parser dockerfile --namespace containerfile --policy "$ROOT/policy" "$ROOT/runtime/Containerfile"

step "Two builds give the same image"
first="$("$ROOT/runtime/build.sh" "$IMAGE")"
second="$("$ROOT/runtime/build.sh" localhost/mayfly-runtime:second-build)"
podman untag localhost/mayfly-runtime:second-build localhost/mayfly-runtime:second-build
[[ "$first" == "$second" ]] || { echo "the builds differ: $first and $second"; exit 1; }
echo "both builds: $first"
echo "layers:"
podman image inspect --format '{{range .RootFS.Layers}}{{println .}}{{end}}' "$IMAGE"

step "The image follows policy"
node "$ROOT/policy/image-facts.ts" "$IMAGE" >"$work/facts.json"
conftest test --namespace image --policy "$ROOT/policy" "$work/facts.json"

step "No known high or critical vulnerabilities"
podman save --quiet --format oci-archive --output "$work/image.tar" "$IMAGE"
grype "oci-archive:$work/image.tar" --fail-on high
