#!/bin/bash
# Phase 3 exit (plan 03-28 prepares it, plans 03-29 and 03-30 run it; D-01 to D-05, D-12).
#
#   scripts/exit-run-phase3.sh --dry-run [--source REPO]
#       Spends nothing, launches no model host, installs nothing and writes nothing to the portfolio (every access is a read of git objects;
#       its HEAD, status, refs and checkout digest are compared before and after). Reads the conventions the owner committed in the portfolio
#       (found the way `avarice start` finds them), prints `conventions: ok` and `staleness: ok`, compiles the three Phase 3 briefs against
#       them at the pin, prints each brief's items with sizes, models and derived files, the Phase 3 spend so far, the headroom to the
#       ceiling and the largest per-run cap that fits three runs. Writes 03-28-dry-run.json (EXIT_DRY_RUN_OUT overrides the path) and exits 0
#       only when it lists no problem.
#   scripts/exit-run-phase3.sh --run BRIEF --authorization-file F
#       The live start (plan 03-29, spends). In order: the tools' `authorize` (the owner's approval names the brief by parseBrief digest, the
#       host is the pinned one and admitted, the preflight is ok, the D-05 guard says the Phase 3 spend plus the authorized per-run cap fits the
#       ceiling; exit 75 = `exit-run: stop and ask the owner (D-05)`, and nothing is started), a snapshot of the owner's checkout and refs,
#       `avarice start --brief B --policy routine --budget costUsdPerRun=<cap> --wait` with cwd the portfolio, the owner's profile and
#       AVARICE_CLAUDE_BIN set to the pinned host, a second snapshot, and the tools' `evidence --stage start` (the run's record into the exit
#       evidence JSON, the spend line into the Phase 3 ledger under plan 03-29). Exit 0 only when the run stopped as the plan expects: blocked on
#       one pause-origin decision with the independent items done. Anything else stops with the diagnosis in the evidence file (D-03: no run is
#       retried by hand). The script never answers a decision: the owner does, in their own terminal.
#   scripts/exit-run-phase3.sh --finish RUNID --authorization-file F
#       After the owner's `avarice decide`: waits for the run's next stop state, takes the checkout snapshot, and records the resume facts (the
#       resume attempt and its session, the session the host's init event reports) and the final evidence with `evidence --stage finish`.
#
# The pinned host: the authorization file names it (host.claudeBin, 2.1.319); this script exports it as AVARICE_CLAUDE_BIN for every start and never
# sets AVARICE_LIVE_ADMIT_CLAUDE_VERSION (it unsets it). ADMITTED_CLAUDE_VERSIONS and the default binary are not touched.
#
# Environment: AVARICE_NODE (the node to run with, default `node`), AVARICE_PORTFOLIO (the owner's checkout, default ~/aa-phan-portfolio-v2;
# only ever read by this script, written only by the supervisor's create-only hand-off of the run branch), AVARICE_PHASE3_LEDGER and
# AVARICE_PHASE3_CEILING_USD (the ledger and a ceiling that can only be lowered), AVARICE_PHASE3_PLAN (the plan the spend and the evidence are recorded
# under, default 03-42), EXIT_EVIDENCE_FILE (default 03-48-evidence-exit.json) and EXIT_RUN_OUT_DIR (the runs' captured output).
#
# The repeated exit (plan 03-41 prepares it, plans 03-42 and 03-30 run it; plan 03-44 prepares the third attempt, plans 03-45 and 03-30 run it; plan 03-47
# prepares the fourth attempt, plans 03-48 and 03-30 run it):
# 03-29-evidence-exit.json is the halted first attempt, 03-42-evidence-exit.json the halted second attempt and 03-45-evidence-exit.json the halted third
# attempt (the records of the D-03 stops of plans 03-29, 03-42 and 03-45); none is written again. The fourth attempt writes 03-48-evidence-exit.json, which
# names the halted 03-45 file, the cancelled run and the reason in its `supersedes` block; `authorize` refuses a start while that run is not failed,
# cancelled or closed in the owner's ledger. Each run's evidence entry
# carries the host configuration directory the run recorded at start (plan 03-43), and the start stage lists a problem when it is missing.
set -u

HERE="$(cd "$(dirname "$0")/.." && pwd -P)"
NODE="${AVARICE_NODE:-$(command -v node)}"
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then echo "exit-run-phase3: no node found (set AVARICE_NODE)" >&2; exit 2; fi
export PATH="$(dirname "$NODE"):$PATH"
TOOLS=("$NODE" --disable-warning=ExperimentalWarning "$HERE/scripts/exit-run-phase3-tools.ts")

CONFIG="$HERE/test/benchmark/portfolio/avarice-config.json"
BRIEFS=("$HERE/test/benchmark/phase3/p3-run1-copy-fallback.md" "$HERE/test/benchmark/phase3/p3-run2-graduation-label.md" "$HERE/test/benchmark/phase3/p3-run3-theme-toggle.md")
DRY_OUT_DEFAULT="$HERE/.planning/phases/03-decisions-independent-work-and-amendments/03-28-dry-run.json"
EVID_DEFAULT="$HERE/.planning/phases/03-decisions-independent-work-and-amendments/03-48-evidence-exit.json"

usage() {
  echo "usage: scripts/exit-run-phase3.sh --dry-run [--source REPO]" >&2
  echo "       scripts/exit-run-phase3.sh --run BRIEF --authorization-file F      (plan 03-29: starts a live run)" >&2
  echo "       scripts/exit-run-phase3.sh --finish RUNID --authorization-file F   (plan 03-29: after the owner's decide)" >&2
  exit 2
}

DRY=0; RUN=0; FINISH=0; SOURCE="${AVARICE_PORTFOLIO:-$HOME/aa-phan-portfolio-v2}"; AUTH=""; RUN_BRIEF=""; FINISH_ID=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --run) RUN=1; shift; [ $# -gt 0 ] || usage; RUN_BRIEF="$1" ;;
    --finish) FINISH=1; shift; [ $# -gt 0 ] || usage; FINISH_ID="$1" ;;
    --source) shift; [ $# -gt 0 ] || usage; SOURCE="$1" ;;
    --authorization-file) shift; [ $# -gt 0 ] || usage; AUTH="$1" ;;
    *) usage ;;
  esac
  shift
done

# What both live modes share: the authorization, the pinned host, the plan the spend is recorded under and where the output goes.
live_setup() {
  [ -n "$AUTH" ] && [ -f "$AUTH" ] || { echo "exit-run-phase3: refusing to spend without --authorization-file (the owner's recorded decision, D-04)" >&2; exit 2; }
  case "$AUTH" in /*) ;; *) AUTH="$PWD/$AUTH" ;; esac
  AVARICE=("$NODE" --disable-warning=ExperimentalWarning "$HERE/bin/avarice.ts")
  EVID="${EXIT_EVIDENCE_FILE:-$EVID_DEFAULT}"
  CLAUDE_BIN="$("${TOOLS[@]}" field --authorization-file "$AUTH" --pick host.claudeBin)" || exit 2
  CLAUDE_VERSION="$("${TOOLS[@]}" field --authorization-file "$AUTH" --pick host.claudeVersion)" || exit 2
  CAP="$("${TOOLS[@]}" field --authorization-file "$AUTH" --pick perRunCapUsd)" || exit 2
  # The pin is explicit here: every host this script launches is the authorized one, and the admission is never widened.
  unset AVARICE_LIVE_ADMIT_CLAUDE_VERSION
  export AVARICE_CLAUDE_BIN="$CLAUDE_BIN"
  export AVARICE_PHASE3_PLAN="${AVARICE_PHASE3_PLAN:-03-42}"
  REAL_TMP="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
  case "$REAL_TMP/" in "$HOME"/.claude*) REAL_TMP="$(cd /tmp && pwd -P)" ;; esac
  RUN_OUT="${EXIT_RUN_OUT_DIR:-$(mktemp -d "$REAL_TMP/avarice-exit-run-XXXXXX")}"
  mkdir -p "$RUN_OUT" || exit 2
  echo "exit-run-phase3: claude $CLAUDE_VERSION at $AVARICE_CLAUDE_BIN, node $("$NODE" --version), per-run cap $CAP USD, output $RUN_OUT"
}

if [ "$RUN" = 1 ]; then
  [ "$DRY" = 0 ] && [ "$FINISH" = 0 ] && [ -n "$RUN_BRIEF" ] || usage
  live_setup
  brief="$RUN_BRIEF"
  case "$brief" in /*) ;; *) brief="$HERE/$brief" ;; esac
  name="$(basename "$brief" .md)"

  "${TOOLS[@]}" authorize --authorization-file "$AUTH" --brief "$brief" --repo "$SOURCE" --config "$CONFIG" --evidence "$EVID"
  code=$?
  if [ "$code" = 75 ]; then echo "exit-run: stop and ask the owner (D-05)" >&2; exit 75; fi
  [ "$code" = 0 ] || { echo "exit-run-phase3: authorization refused for $name (exit $code); nothing was started" >&2; exit "$code"; }

  "${TOOLS[@]}" snapshot --repo "$SOURCE" > "$RUN_OUT/$name.before.json" || { echo "exit-run-phase3: cannot snapshot $SOURCE" >&2; exit 1; }
  started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "exit-run-phase3: starting $name at $started_at"
  (cd "$SOURCE" && "${AVARICE[@]}" start --brief "$brief" --policy routine --budget "costUsdPerRun=$CAP" --wait) > "$RUN_OUT/$name.start.out" 2> "$RUN_OUT/$name.start.err"
  start_exit=$?
  cat "$RUN_OUT/$name.start.out"
  [ -s "$RUN_OUT/$name.start.err" ] && cat "$RUN_OUT/$name.start.err" >&2
  "${TOOLS[@]}" snapshot --repo "$SOURCE" > "$RUN_OUT/$name.after.json" || { echo "exit-run-phase3: cannot snapshot $SOURCE after the start" >&2; exit 1; }
  run_id="$(grep -o 'run_[0-9A-Z]\{26\}' "$RUN_OUT/$name.start.out" | head -n 1)"
  if [ -z "$run_id" ]; then echo "exit-run-phase3: start printed no run ID (exit $start_exit): nothing was stored; see $RUN_OUT/$name.start.err" >&2; exit 1; fi

  "${TOOLS[@]}" evidence --stage start --run-id "$run_id" --brief "$brief" --repo "$SOURCE" --authorization-file "$AUTH" \
    --before "$RUN_OUT/$name.before.json" --after "$RUN_OUT/$name.after.json" \
    --start-exit "$start_exit" --start-out "$RUN_OUT/$name.start.out" --start-err "$RUN_OUT/$name.start.err" \
    --started-at "$started_at" --out "$EVID"
  ecode=$?
  if [ "$ecode" != 0 ]; then
    echo "exit-run-phase3: $name did not stop as expected (start exit $start_exit, evidence exit $ecode); stopping for the diagnosis in $EVID (D-03)" >&2
    exit 1
  fi
  exit 0
fi

if [ "$FINISH" = 1 ]; then
  [ "$DRY" = 0 ] && [ -n "$FINISH_ID" ] || usage
  live_setup
  run_id="$FINISH_ID"
  brief="$("$NODE" -e '
    const e = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    const r = (e.runs || []).find((x) => x.runId === process.argv[2]);
    if (!r) process.exit(1);
    process.stdout.write(require("node:path").resolve(process.argv[3], r.brief));
  ' "$EVID" "$run_id" "$HERE")" || { echo "exit-run-phase3: $EVID has no start-stage record of $run_id" >&2; exit 2; }
  "${TOOLS[@]}" evidence --stage finish --run-id "$run_id" --brief "$brief" --repo "$SOURCE" --authorization-file "$AUTH" --out "$EVID"
  ecode=$?
  if [ "$ecode" != 0 ]; then
    echo "exit-run-phase3: run $run_id did not finish as expected (evidence exit $ecode); see the diagnosis in $EVID (D-03)" >&2
    exit "$ecode"
  fi
  exit 0
fi

[ "$DRY" = 1 ] || usage

OUT="${EXIT_DRY_RUN_OUT:-$DRY_OUT_DEFAULT}"
BRIEF_ARGS=()
for b in "${BRIEFS[@]}"; do BRIEF_ARGS+=(--brief "$b"); done

"${TOOLS[@]}" dry-run --source "$SOURCE" --config "$CONFIG" "${BRIEF_ARGS[@]}" --out "$OUT"
code=$?
if [ "$code" = 0 ]; then echo "dry run ok"; else echo "dry run FAILED" >&2; fi
exit "$code"
