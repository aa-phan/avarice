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
#   scripts/exit-run-phase2.sh --run BRIEF... --authorization-file F        (plan 02-22; spends: one `avarice start` per brief)
#       The live exit. For each brief, in order: the tools' `authorize` (the owner's approval names the brief by parseBrief digest, the
#       preflight is ok, the D-15 ceiling guard fits the run's cap; exit 75 = `stop and ask the owner`), a snapshot of the owner's checkout
#       and refs, `avarice start --brief B --policy routine --wait` with cwd the portfolio and the owner's profile, a second snapshot, and
#       the tools' `evidence` (spend line into the Phase 2 ledger, the run's record into the exit evidence JSON). The script stops at the
#       first run that does not end `ready_for_review` (D-08: no run is retried by hand) with the diagnosis in the evidence file.
#       Environment: EXIT_EVIDENCE_FILE (default .planning/phases/02-.../02-22-evidence-exit.json), EXIT_RUN_OUT_DIR (the runs' output).
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

DRY=0; RUN=0; SOURCE="${AVARICE_PORTFOLIO:-$HOME/aa-phan-portfolio-v2}"; AUTH=""; EXTRA=(); RUN_BRIEFS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --run) RUN=1 ;;
    --source) shift; [ $# -gt 0 ] || usage; SOURCE="$1" ;;
    --authorization-file) shift; [ $# -gt 0 ] || usage; AUTH="$1" ;;
    --temp-profile|--keep) EXTRA+=("$1") ;;
    --*) usage ;;
    *) [ "$RUN" = 1 ] || usage; RUN_BRIEFS+=("$1") ;;
  esac
  shift
done

if [ "$RUN" = 1 ]; then
  [ "$DRY" = 0 ] && [ ${#RUN_BRIEFS[@]} -gt 0 ] || usage
  [ -n "$AUTH" ] && [ -f "$AUTH" ] || { echo "exit-run-phase2: refusing to spend without --authorization-file (the owner's recorded decision)" >&2; exit 2; }
  AVARICE=("$NODE" --disable-warning=ExperimentalWarning "$HERE/bin/avarice.ts")
  EVID="${EXIT_EVIDENCE_FILE:-$HERE/.planning/phases/02-contained-unattended-run-of-one-work-item/02-22-evidence-exit.json}"
  LEDGER="$HERE/test/containment/live-spend-phase2.jsonl"
  REAL_TMP="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
  case "$REAL_TMP/" in "$HOME"/.claude*) echo "exit-run-phase2: TMPDIR $REAL_TMP is under a Claude config directory; set TMPDIR elsewhere" >&2; exit 2 ;; esac
  RUN_OUT="${EXIT_RUN_OUT_DIR:-$(mktemp -d "$REAL_TMP/avarice-exit-run-XXXXXX")}"
  mkdir -p "$RUN_OUT" || exit 2
  export AVARICE_PHASE2_PLAN=02-22
  # The owner's profile (no AVARICE_*_ROOT override) and an admitted claude, picked the way plan 01-19's exit run does.
  CLAUDE_PICK="$("$NODE" --disable-warning=ExperimentalWarning "$HERE/scripts/exit-run-tools.ts" pick-claude)" || { echo "exit-run-phase2: no admitted claude" >&2; exit 1; }
  export AVARICE_CLAUDE_BIN="${CLAUDE_PICK%%$'\t'*}"
  echo "exit-run-phase2: claude ${CLAUDE_PICK##*$'\t'} at $AVARICE_CLAUDE_BIN, node $("$NODE" --version), output $RUN_OUT"
  n=0
  for brief in "${RUN_BRIEFS[@]}"; do
    n=$((n + 1))
    case "$brief" in /*) ;; *) brief="$HERE/$brief" ;; esac
    name="$(basename "$brief" .md)"
    "${TOOLS[@]}" authorize --authorization-file "$AUTH" --brief "$brief" --repo "$SOURCE" --config "$CONFIG" --evidence "$EVID"
    code=$?
    if [ "$code" = 75 ]; then echo "exit-run: stop and ask the owner (D-15)" >&2; exit 75; fi
    [ "$code" = 0 ] || { echo "exit-run-phase2: authorization refused for $name (exit $code); nothing was started" >&2; exit "$code"; }
    "${TOOLS[@]}" snapshot --repo "$SOURCE" > "$RUN_OUT/$name.before.json" || { echo "exit-run-phase2: cannot snapshot $SOURCE" >&2; exit 1; }
    started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "exit-run-phase2: starting $name ($n of ${#RUN_BRIEFS[@]}) at $started_at"
    (cd "$SOURCE" && "${AVARICE[@]}" start --brief "$brief" --policy routine --wait) > "$RUN_OUT/$name.start.out" 2> "$RUN_OUT/$name.start.err"
    start_exit=$?
    ended_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    cat "$RUN_OUT/$name.start.out"
    [ -s "$RUN_OUT/$name.start.err" ] && cat "$RUN_OUT/$name.start.err" >&2
    "${TOOLS[@]}" snapshot --repo "$SOURCE" > "$RUN_OUT/$name.after.json" || { echo "exit-run-phase2: cannot snapshot $SOURCE after the run" >&2; exit 1; }
    run_id="$(grep -o 'run_[0-9A-Z]\{26\}' "$RUN_OUT/$name.start.out" | head -n 1)"
    if [ -z "$run_id" ]; then echo "exit-run-phase2: start printed no run ID (exit $start_exit): nothing was stored; see $RUN_OUT/$name.start.err" >&2; exit 1; fi
    "${TOOLS[@]}" evidence --run-id "$run_id" --brief "$brief" --before "$RUN_OUT/$name.before.json" --after "$RUN_OUT/$name.after.json" \
      --start-exit "$start_exit" --start-out "$RUN_OUT/$name.start.out" --start-err "$RUN_OUT/$name.start.err" \
      --started-at "$started_at" --ended-at "$ended_at" --out "$EVID" --ledger "$LEDGER" --repo "$SOURCE"
    ecode=$?
    if [ "$ecode" != 0 ] || [ "$start_exit" != 0 ]; then
      echo "exit-run-phase2: $name did not end clean in ready_for_review (start exit $start_exit, evidence exit $ecode); stopping for the diagnosis in $EVID (D-08)" >&2
      exit 1
    fi
  done
  exit 0
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
