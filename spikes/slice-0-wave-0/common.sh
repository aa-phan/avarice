#!/usr/bin/env bash
# Shared setup for the Wave 0 spike scripts. Source it; do not execute it.
# SPIKE_ROOT holds every scratch repository, worktree, transcript and ledger. It is never inside a Claude
# config directory (~/.claude*) and never inside the AVARICE repository or a user repository.

die() { echo "FATAL: $*" >&2; exit 1; }

REAL_HOME=$(cd "$HOME" && pwd -P)
SPIKE_ROOT=${SPIKE_ROOT:-$HOME/.local/share/avarice-spikes/wave-0}
mkdir -p "$SPIKE_ROOT"
SPIKE_ROOT=$(cd "$SPIKE_ROOT" && pwd -P)
case "$SPIKE_ROOT" in
  "$REAL_HOME"/.claude*|"$HOME"/.claude*) die "SPIKE_ROOT must not live under a ~/.claude* directory: $SPIKE_ROOT" ;;
  "$REAL_HOME"/avarice|"$REAL_HOME"/avarice/*|"$REAL_HOME"/aa-phan-portfolio-v2|"$REAL_HOME"/aa-phan-portfolio-v2/*) die "SPIKE_ROOT must not live inside a repository: $SPIKE_ROOT" ;;
esac
export SPIKE_ROOT
SPIKE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
GSD_CORE=${GSD_CORE:-$HOME/.claude/gsd-core}
CLAUDE_BIN=${CLAUDE_BIN:-$HOME/.local/bin/claude}
TARGET_REPO=${TARGET_REPO:-$HOME/aa-phan-portfolio-v2}
mkdir -p "$SPIKE_ROOT/out"

# Safe-git variables from SKELETON.md: repository hooks and fsmonitor are neutralized on every git call.
SAFE_GIT_ENV=(GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null
              GIT_CONFIG_KEY_1=core.fsmonitor GIT_CONFIG_VALUE_1=false GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0)

# assert_under_root PATH: refuse to remove or write anything outside SPIKE_ROOT.
assert_under_root() {
  case "$1" in "$SPIKE_ROOT"/*) ;; *) die "path outside SPIKE_ROOT: $1" ;; esac
}
