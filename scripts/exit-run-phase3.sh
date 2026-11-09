#!/bin/bash
# Phase 3 exit (plan 03-28 prepares it, plan 03-29 runs it; D-01 to D-05, D-12).
#
#   scripts/exit-run-phase3.sh --dry-run [--source REPO]
#       Spends nothing, launches no model host, installs nothing and writes nothing to the portfolio (every access is a read of git objects;
#       its HEAD, status, refs and checkout digest are compared before and after). Reads the conventions the owner committed in the portfolio
#       (found the way `avarice start` finds them), prints `conventions: ok` and `staleness: ok`, compiles the three Phase 3 briefs against
#       them at the pin, prints each brief's items with sizes, models and derived files, the Phase 3 spend so far, the headroom to the
#       ceiling and the largest per-run cap that fits three runs. Writes 03-28-dry-run.json (EXIT_DRY_RUN_OUT overrides the path) and exits 0
#       only when it lists no problem.
#   scripts/exit-run-phase3.sh --run BRIEF --authorization-file F
#       The live exit (plan 03-29, spends). Not implemented by plan 03-28: it refuses (exit 2) and starts nothing.
#
# Environment: AVARICE_NODE (the node to run with, default `node`), AVARICE_PORTFOLIO (the owner's checkout, default ~/aa-phan-portfolio-v2;
# only ever read), AVARICE_PHASE3_LEDGER and AVARICE_PHASE3_CEILING_USD (the ledger and a ceiling that can only be lowered).
set -u

HERE="$(cd "$(dirname "$0")/.." && pwd -P)"
NODE="${AVARICE_NODE:-$(command -v node)}"
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then echo "exit-run-phase3: no node found (set AVARICE_NODE)" >&2; exit 2; fi
export PATH="$(dirname "$NODE"):$PATH"
TOOLS=("$NODE" --disable-warning=ExperimentalWarning "$HERE/scripts/exit-run-phase3-tools.ts")

CONFIG="$HERE/test/benchmark/portfolio/avarice-config.json"
BRIEFS=("$HERE/test/benchmark/phase3/p3-run1-copy-fallback.md" "$HERE/test/benchmark/phase3/p3-run2-graduation-label.md" "$HERE/test/benchmark/phase3/p3-run3-theme-toggle.md")
DRY_OUT_DEFAULT="$HERE/.planning/phases/03-decisions-independent-work-and-amendments/03-28-dry-run.json"

usage() {
  echo "usage: scripts/exit-run-phase3.sh --dry-run [--source REPO]" >&2
  echo "       scripts/exit-run-phase3.sh --run BRIEF --authorization-file F   (plan 03-29)" >&2
  exit 2
}

DRY=0; RUN=0; SOURCE="${AVARICE_PORTFOLIO:-$HOME/aa-phan-portfolio-v2}"; AUTH=""; RUN_BRIEF=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --run) RUN=1; shift; [ $# -gt 0 ] || usage; RUN_BRIEF="$1" ;;
    --source) shift; [ $# -gt 0 ] || usage; SOURCE="$1" ;;
    --authorization-file) shift; [ $# -gt 0 ] || usage; AUTH="$1" ;;
    *) usage ;;
  esac
  shift
done

if [ "$RUN" = 1 ]; then
  [ "$DRY" = 0 ] && [ -n "$RUN_BRIEF" ] || usage
  [ -n "$AUTH" ] && [ -f "$AUTH" ] || { echo "exit-run-phase3: refusing to spend without --authorization-file (the owner's recorded decision, D-04)" >&2; exit 2; }
  echo "exit-run-phase3: --run is implemented by plan 03-29; plan 03-28 starts nothing" >&2
  exit 2
fi
[ "$DRY" = 1 ] || usage

OUT="${EXIT_DRY_RUN_OUT:-$DRY_OUT_DEFAULT}"
BRIEF_ARGS=()
for b in "${BRIEFS[@]}"; do BRIEF_ARGS+=(--brief "$b"); done

"${TOOLS[@]}" dry-run --source "$SOURCE" --config "$CONFIG" "${BRIEF_ARGS[@]}" --out "$OUT"
code=$?
if [ "$code" = 0 ]; then echo "dry run ok"; else echo "dry run FAILED" >&2; fi
exit "$code"
