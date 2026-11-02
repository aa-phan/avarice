#!/bin/bash
# Runs the whole suite (T1 unit and T2 integration, no live tier) on two Node versions: the minimum supported
# Node 22.22.3 named by AVARICE_NODE22 and the `node` on PATH (the development Node). Prints both summaries and
# exits non-zero when either leg fails. Exit 2 means AVARICE_NODE22 is not set or not executable.
#
#   AVARICE_NODE22=/path/to/node-v22.22.3-darwin-arm64/bin/node bash scripts/test-matrix.sh
set -u

if [ -z "${AVARICE_NODE22:-}" ] || [ ! -x "${AVARICE_NODE22}" ]; then
  echo "test-matrix: set AVARICE_NODE22 to the path of a Node 22.22.3 binary (for example the bin/node of the official node-v22.22.3 tarball unpacked in a scratch directory)" >&2
  exit 2
fi

cd "$(dirname "$0")/.." || exit 2
status=0

run_leg() {
  local label="$1" node_bin="$2" out rc
  echo "== ${label}: $("$node_bin" --version) (${node_bin})"
  out="$(PATH="$(dirname "$node_bin"):$PATH" "$node_bin" --test --test-reporter=tap 2>&1)"
  rc=$?
  printf '%s\n' "$out" | grep -E '^not ok|^# (tests|pass|fail|cancelled|skipped)' || true
  if [ "$rc" -ne 0 ]; then
    echo "== ${label}: FAILED (exit ${rc})"
    status=1
  else
    echo "== ${label}: ok"
  fi
}

run_leg "node 22.22.3" "$AVARICE_NODE22"
run_leg "dev node" "$(command -v node)"
exit "$status"
