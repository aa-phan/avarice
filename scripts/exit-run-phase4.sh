#!/bin/bash
# Phase 4 exit: the AC-14 brownfield benchmark (plan 04-35; ONB-6, ONB-11, ONB-15; D-03, D-04, D-05).
#
#   scripts/exit-run-phase4.sh --dry-run [--per-repo USD] [--profile extended|local]
#       Spends nothing and starts no model. Reads the owner-approved list, clones the public repositories at their pins into the benchmark clone root,
#       digests every checkout and its refs, and prints the five repositories with their expected path, profile and cap and the projected spend against the
#       Phase 4 ledger. Exit 0 only when it lists no problem.
#
#   The owner then authorizes in their own terminal (this script never does, and the tool refuses without an interactive terminal):
#       node scripts/exit-run-phase4-tools.ts authorize --cap <usd> --profile extended|local
#
#   scripts/exit-run-phase4.sh --run [--only ID] [--ruling-ref TEXT]
#       The live onboardings (spends). Each approved repository in the list's order through the tools' `run-one`, then `verify`. It halts at the first repository
#       that does not end active with equal digests (D-04: the evidence is recorded, nothing is retried by this script) and exits with that repository's code
#       (75 = stop and ask the owner). `--only ID` runs one repository, as a retry after the owner's ruling (`--ruling-ref` names the ruling and needs `--only`).
#       An `--only` id that is not on the approved list exits 2 and runs nothing.
#   scripts/exit-run-phase4.sh --verify     5 of 5 active, every digest equal, 0 containment failures.
#   scripts/exit-run-phase4.sh --finish     verify, then record the close of the benchmark in the evidence file.
#
# Environment: AVARICE_NODE (the node to run with, default `node`), AVARICE_AC14_ROOT (the clone root of the public repositories), AVARICE_PHASE4_CEILING_USD
# (lowers the ceiling, never raises it). The benchmark runs in the owner's own profile roots: AVARICE_DATA_ROOT, AVARICE_WORK_ROOT and AVARICE_CONFIG_HOME must be unset.
set -u

HERE="$(cd "$(dirname "$0")/.." && pwd -P)"
NODE="${AVARICE_NODE:-$(command -v node)}"
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then echo "exit-run-phase4: no node found (set AVARICE_NODE)" >&2; exit 2; fi
export PATH="$(dirname "$NODE"):$PATH"
TOOLS=("$NODE" --disable-warning=ExperimentalWarning "$HERE/scripts/exit-run-phase4-tools.ts")

usage() {
  echo "usage: scripts/exit-run-phase4.sh --dry-run [--per-repo USD] [--profile extended|local]" >&2
  echo "       scripts/exit-run-phase4.sh --run [--only ID] [--ruling-ref TEXT]   (spends; after the owner's authorize)" >&2
  echo "       scripts/exit-run-phase4.sh --verify | --finish" >&2
  exit 2
}

[ $# -gt 0 ] || usage
mode="$1"
shift

case "$mode" in
  --dry-run)
    "${TOOLS[@]}" dry-run "$@"
    code=$?
    if [ "$code" = 0 ]; then echo "dry run ok"; else echo "dry run FAILED" >&2; fi
    exit "$code"
    ;;
  --verify) exec "${TOOLS[@]}" verify "$@" ;;
  --finish) exec "${TOOLS[@]}" finish "$@" ;;
  --run)
    only=""
    ruling=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --only) shift; { [ $# -gt 0 ] && [ -n "$1" ]; } || usage; only="$1" ;;
        --ruling-ref) shift; [ $# -gt 0 ] || usage; ruling="$1" ;;
        *) usage ;;
      esac
      shift
    done
    # One ruling reference unlocks the retry of one repository: without --only it would reach every run-one.
    if [ -n "$ruling" ] && [ -z "$only" ]; then echo "exit-run-phase4: --ruling-ref needs --only" >&2; usage; fi
    ids="$("${TOOLS[@]}" ids)" || exit 2
    # A retry that names no approved repository would run nothing and report success.
    if [ -n "$only" ] && ! printf '%s\n' "$ids" | grep -Fqx -- "$only"; then echo "exit-run-phase4: $only is not on the approved list" >&2; exit 2; fi
    for id in $ids; do
      if [ -n "$only" ] && [ "$id" != "$only" ]; then continue; fi
      "${TOOLS[@]}" run-one "$id" ${ruling:+--ruling-ref "$ruling"}
      code=$?
      if [ "$code" = 75 ]; then echo "exit-run-phase4: stop and ask the owner (D-04, D-05) at $id" >&2; exit 75; fi
      if [ "$code" != 0 ]; then
        echo "exit-run-phase4: $id did not end active with equal digests (exit $code); stopping for the diagnosis in the evidence file (D-04)" >&2
        exit "$code"
      fi
    done
    if [ -z "$only" ]; then "${TOOLS[@]}" verify; exit $?; fi
    exit 0
    ;;
  *) usage ;;
esac
