#!/bin/bash
# Phase 2 exit (plan 02-21 prepares it, plan 02-22 runs it; ROADMAP Phase 2 success criteria; D-05 to D-11, D-15, D-16).
#
#   scripts/exit-run-phase2.sh --dry-run [--source REPO] [--temp-profile] [--keep]
#       Spends nothing and writes nothing to the portfolio. Parses the drafts (test/benchmark/portfolio/avarice-config.json and the three
#       test/benchmark/r1 briefs) with the real parsers, compiles each brief against the draft conventions, and in a scratch clone of the
#       portfolio at the pin (a throwaway profile under the default AVARICE parents) installs dependencies through the egress proxy,
#       runs ONB-10 validation and a baseline of every declared check plus the test inventory. Needs the network for npm only:
#       run it with AVARICE_NET=1. Writes `exit-dry-run.json` into EXIT_RUN_OUT_DIR (default: a new temp directory) and exits 0 only when
#       every required check is `active` and the inventory command works.
#   scripts/exit-run-phase2.sh --run BRIEF... --authorization-file F        added by plan 02-22 (refuses until then)
#
# Realpath note: the allow rules AVARICE generates name symlink-resolved paths (macOS: $TMPDIR is /var/folders/..., really
# /private/var/folders/...). Every path in the conventions file is repository-relative, so none needs resolving; the exit runs use the
# default profile (work root ~/.local/share/avarice-work, no symlink); anything handed to the model by hand must be a `realpath`.
#
# Environment: AVARICE_NODE (the node to run with, default `node`), AVARICE_NET=1 (the dry run's install), EXIT_RUN_OUT_DIR,
# AVARICE_PORTFOLIO (the owner's checkout, default ~/aa-phan-portfolio-v2; only ever read).
set -u

HERE="$(cd "$(dirname "$0")/.." && pwd -P)"
NODE="${AVARICE_NODE:-$(command -v node)}"
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then echo "exit-run-phase2: no node found (set AVARICE_NODE)" >&2; exit 2; fi
export PATH="$(dirname "$NODE"):$PATH"
TOOLS=("$NODE" --disable-warning=ExperimentalWarning "$HERE/scripts/exit-run-phase2-tools.ts")

CONFIG="$HERE/test/benchmark/portfolio/avarice-config.json"
BRIEFS=("$HERE/test/benchmark/r1/r1-bug-swipe-nonfinite.md" "$HERE/test/benchmark/r1/r1-refactor-copy-textarea.md" "$HERE/test/benchmark/r1/r1-docs-dates-predicate.md")

usage() {
  echo "usage: scripts/exit-run-phase2.sh --dry-run [--source REPO] [--temp-profile] [--keep]" >&2
  echo "       scripts/exit-run-phase2.sh --run BRIEF... --authorization-file F   (plan 02-22)" >&2
  exit 2
}

DRY=0; RUN=0; SOURCE="${AVARICE_PORTFOLIO:-$HOME/aa-phan-portfolio-v2}"; AUTH=""; EXTRA=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --run) RUN=1 ;;
    --source) shift; [ $# -gt 0 ] || usage; SOURCE="$1" ;;
    --authorization-file) shift; [ $# -gt 0 ] || usage; AUTH="$1" ;;
    --temp-profile|--keep) EXTRA+=("$1") ;;
    *) [ "$RUN" = 1 ] || usage ;;
  esac
  shift
done

if [ "$RUN" = 1 ]; then
  echo "exit-run-phase2: --run is implemented by plan 02-22; this plan prepares and proves the drafts (--dry-run)" >&2
  exit 2
fi
[ "$DRY" = 1 ] || usage

OUT_DIR="${EXIT_RUN_OUT_DIR:-$(mktemp -d "$(cd "${TMPDIR:-/tmp}" && pwd -P)/avarice-exit-dry-out-XXXXXX")}"
mkdir -p "$OUT_DIR" || exit 2
OUT="$OUT_DIR/exit-dry-run.json"

BRIEF_ARGS=()
for b in "${BRIEFS[@]}"; do BRIEF_ARGS+=(--brief "$b"); done

"${TOOLS[@]}" dry-run --source "$SOURCE" --config "$CONFIG" "${BRIEF_ARGS[@]}" --out "$OUT" "${EXTRA[@]+"${EXTRA[@]}"}"
code=$?
echo "exit-run-phase2: dry-run JSON $OUT"
if [ "$code" = 0 ]; then echo "dry run ok"; else echo "dry run FAILED" >&2; fi
exit "$code"
