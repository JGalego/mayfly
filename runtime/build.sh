#!/usr/bin/env bash
# Builds the runtime image every generated app starts from, for amd64 and arm64, as one manifest list that
# Podman resolves to the machine's platform. The build is reproducible: the same commit always gives the same
# image digests, which check.sh proves by building twice. It prints them, amd64's first.
set -euo pipefail

readonly APKO="cgr.dev/chainguard/apko@sha256:627d5cb31ef831748e2ae3528a0d7760276f823a6efc4f31b3a4cb87223fee73"
readonly BASE="localhost/mayfly-runtime-base:node24"
readonly IMAGE="${1:-localhost/mayfly-runtime:dev}"
readonly ARCHES=(amd64 arm64)
RUNTIME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly RUNTIME_DIR

# Every timestamp in the image is fixed, so only content changes the digest.
export SOURCE_DATE_EPOCH=0
umask 022
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# The base: Node 24 from Wolfi, exactly the packages in base.apko.lock.json. apko tags each architecture's image
# with its name; the Containerfile pins the list of them by digest.
build_base() {
  cp "$RUNTIME_DIR/base.apko.yaml" "$RUNTIME_DIR/base.apko.lock.json" "$work/"
  podman run --rm --env SOURCE_DATE_EPOCH --volume "$work:/work:Z" --workdir /work "$APKO" \
    --log-level warn build --lockfile base.apko.lock.json base.apko.yaml "$BASE" base.tar >/dev/null
  podman load --quiet --input "$work/base.tar" >/dev/null
  make_list "$BASE"
}

# Lists $1-amd64 and $1-arm64 under $1, taking the name from an earlier list or image.
make_list() {
  if podman manifest exists "$1" 2>/dev/null; then podman manifest rm "$1" >/dev/null; else podman untag "$1" 2>/dev/null || true; fi
  podman manifest create "$1" "${ARCHES[@]/#/containers-storage:$1-}" >/dev/null
}

# A clean copy of the runtime's sources, without tests, and its production dependencies only.
stage_context() {
  mkdir -p "$work/context/src"
  cp "$RUNTIME_DIR/package.json" "$RUNTIME_DIR/package-lock.json" "$work/context/"
  find "$RUNTIME_DIR/src" -name '*.ts' ! -name '*.test.ts' -exec cp {} "$work/context/src/" \;
  npm ci --prefix "$work/context" --omit=dev --ignore-scripts --no-audit --no-fund --silent
}

# Nothing runs during the build, so the arm64 image needs no emulation.
build_runtime() {
  for arch in "${ARCHES[@]}"; do
    podman build --quiet --no-cache --pull=never --platform "linux/$arch" \
      --source-date-epoch "$SOURCE_DATE_EPOCH" --rewrite-timestamp \
      --build-arg REVISION="$(git -C "$RUNTIME_DIR" rev-parse HEAD)" \
      --file "$RUNTIME_DIR/Containerfile" --tag "$IMAGE-$arch" "$work/context" >/dev/null
  done
  make_list "$IMAGE"
}

build_base
stage_context
build_runtime
podman image inspect --format '{{.Id}}' "${ARCHES[@]/#/$IMAGE-}" | paste -sd ' '
