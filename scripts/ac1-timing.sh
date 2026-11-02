#!/bin/bash
# AC-1 timing (docs/operations-and-testing.md T-9; 01-VALIDATION.md AC-1): from a clone of this repository to
# the first successful `avarice status`, in a scratch HOME, with no admin rights and no package installs (the
# runtime has no dependencies; Phase 1 installs by cloning, research Pitfall 8). Prints
#   AC-1 elapsed {n}s (target 600s)
# and exits 0 only when both commands succeed and the elapsed time is under the target.
#
#   AC1_TARGET_SECONDS  override the 600 s target
#   AC1_KEEP=1          keep the scratch directory for inspection
set -u

TARGET="${AC1_TARGET_SECONDS:-600}"
SOURCE="$(cd "$(dirname "$0")/.." && pwd -P)"

# Resolve a path through its nearest existing ancestor, like the root rules do.
real_path() {
  local p="$1" tail=""
  while [ ! -e "$p" ] && [ "$p" != "/" ]; do tail="/$(basename "$p")$tail"; p="$(dirname "$p")"; done
  echo "$(cd "$p" && pwd -P)$tail"
}

REAL_HOME="$(real_path "${HOME:?HOME is not set}")"
REAL_CLAUDE_DIR="$(real_path "${CLAUDE_CONFIG_DIR:-$HOME/.claude}")"

SCRATCH_PARENT="$(real_path "${TMPDIR:-/tmp}")"
case "$SCRATCH_PARENT/" in
  "$REAL_HOME"/.claude*|"$REAL_CLAUDE_DIR"/*|"$REAL_CLAUDE_DIR"/)
    echo "AC-1 refused: the scratch directory would be under a Claude config directory ($SCRATCH_PARENT); set TMPDIR elsewhere" >&2
    exit 2
    ;;
esac

SCRATCH="$(mktemp -d "$SCRATCH_PARENT/avarice-ac1-XXXXXX")" || exit 2
SCRATCH="$(cd "$SCRATCH" && pwd -P)"
cleanup() {
  [ "${AC1_KEEP:-0}" = "1" ] || rm -rf "$SCRATCH"
}
trap cleanup EXIT

SCRATCH_HOME="$SCRATCH/home"
CLONE="$SCRATCH/clone"
mkdir -p "$SCRATCH_HOME"

# Fresh-account environment: the scratch HOME and its own Claude config directory, no profile overrides.
run_in_scratch() {
  env -u AVARICE_CONFIG_HOME -u AVARICE_DATA_ROOT -u AVARICE_WORK_ROOT -u AVARICE_FAKE_HOST -u AVARICE_FAULT \
    HOME="$SCRATCH_HOME" CLAUDE_CONFIG_DIR="$SCRATCH_HOME/.claude" "$@"
}

START=$(date +%s)

echo "AC-1: cloning $SOURCE"
if ! git clone --local --no-hardlinks --quiet "$SOURCE" "$CLONE"; then
  echo "AC-1 failed: git clone" >&2
  exit 1
fi

echo "AC-1: bin/avarice init"
if ! run_in_scratch "$CLONE/bin/avarice" init; then
  echo "AC-1 failed: avarice init" >&2
  exit 1
fi

echo "AC-1: bin/avarice status"
if ! run_in_scratch "$CLONE/bin/avarice" status; then
  echo "AC-1 failed: avarice status" >&2
  exit 1
fi

END=$(date +%s)
ELAPSED=$((END - START))
echo "AC-1 elapsed ${ELAPSED}s (target ${TARGET}s)"
if [ "$ELAPSED" -ge "$TARGET" ]; then
  echo "AC-1 failed: ${ELAPSED}s is not under ${TARGET}s" >&2
  exit 1
fi
exit 0
