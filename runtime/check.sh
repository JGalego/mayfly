#!/usr/bin/env bash
# Proves the runtime image meets the policies in policy/: the policies pass their own tests, the
# Containerfile follows them, two builds give the same digests, and the image for each architecture
# follows them and has no known high or critical vulnerabilities. Run it with `pixi run check-image`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT
readonly IMAGE="localhost/mayfly-runtime:dev"
readonly SECOND="localhost/mayfly-runtime:second-build"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

step() { printf '\n== %s\n' "$1"; }

step "The policies pass their own tests"
conftest verify --policy "$ROOT/policy"

step "The Containerfile follows policy"
conftest test --parser dockerfile --namespace containerfile --policy "$ROOT/policy" "$ROOT/runtime/Containerfile"

step "Two builds give the same images"
first="$("$ROOT/runtime/build.sh" "$IMAGE")"
second="$("$ROOT/runtime/build.sh" "$SECOND")"
podman manifest rm "$SECOND" >/dev/null
for arch in amd64 arm64; do
  # Named twice, so only that name goes: the first build's image is the same one.
  podman untag "$SECOND-$arch" "$SECOND-$arch"
done
[[ "$first" == "$second" ]] || { echo "the builds differ: $first and $second"; exit 1; }
echo "both builds: $first"

for arch in amd64 arm64; do
  step "The $arch image follows policy"
  echo "layers:"
  podman image inspect --format '{{range .RootFS.Layers}}{{println .}}{{end}}' "$IMAGE-$arch"
  node "$ROOT/policy/image-facts.ts" "$IMAGE-$arch" >"$work/facts.json"
  conftest test --namespace image --policy "$ROOT/policy" "$work/facts.json"

  step "The $arch image has no known high or critical vulnerabilities"
  podman save --quiet --format oci-archive --output "$work/$arch.tar" "$IMAGE-$arch"
  grype "oci-archive:$work/$arch.tar" --fail-on high
done
