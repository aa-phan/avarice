#!/usr/bin/env bash
# usage: harness.sh CASE PROMPT --max-budget-usd N [--max-seconds S] [extra claude flags...]
# Runs one contained `claude -p` invocation for cases/CASE.json under an env rebuilt from an allowlist.
# Refuses to start without --max-budget-usd, and refuses when ledger spend plus this run's cap would exceed
# the authorized total in $SPIKE_ROOT/authorization.json. Appends the measured cost to $SPIKE_ROOT/ledger.jsonl.
set -euo pipefail
. "$(dirname "$0")/common.sh"

CASE=${1:?case name}; PROMPT=${2:?prompt}; shift 2
BUDGET=""; MAXSEC=600; EXTRA=()
while (($#)); do
  case "$1" in
    --max-budget-usd) BUDGET=${2:?}; shift 2 ;;
    --max-seconds) MAXSEC=${2:?}; shift 2 ;;
    *) EXTRA+=("$1"); shift ;;
  esac
done
[ -n "$BUDGET" ] || die "--max-budget-usd is required (every spike run carries its own cap)"
[[ "$BUDGET" =~ ^[0-9]+(\.[0-9]+)?$ ]] || die "--max-budget-usd must be a number: $BUDGET"
for a in "${EXTRA[@]:-}"; do
  case "$a" in --dangerously-skip-permissions|--bare|--permission-mode=*|bypassPermissions) die "forbidden flag: $a" ;; esac
done
AUTH="$SPIKE_ROOT/authorization.json"; LEDGER="$SPIKE_ROOT/ledger.jsonl"
[ -f "$AUTH" ] || die "no authorization.json under SPIKE_ROOT (the spend decision has not been recorded)"
touch "$LEDGER"

# Spend gate (T-01-06): ledger total + this run's cap must stay within the authorized cap.
node -e '
const fs=require("fs"); const auth=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const spent=fs.readFileSync(process.argv[2],"utf8").split("\n").filter(Boolean).reduce((s,l)=>s+JSON.parse(l).costUsd,0);
const cap=Number(process.argv[3]);
if (spent+cap>auth.capUsd+1e-9) { console.error(`REFUSED: spent ${spent.toFixed(4)} + cap ${cap} > authorized ${auth.capUsd}`); process.exit(3); }
' "$AUTH" "$LEDGER" "$BUDGET" || exit 3

# Case files come from the committed cases/ directory; S0-F cases are generated under $SPIKE_ROOT/cases because they
# list the top-level entries of the user's repository.
CASEFILE="$SPIKE_ROOT/cases/$CASE.json"; [ -f "$CASEFILE" ] || CASEFILE="$SPIKE_DIR/cases/$CASE.json"
[ -f "$CASEFILE" ] || die "no case file for $CASE"
OUT="$SPIKE_ROOT/out"; SETTINGS="$OUT/$CASE.settings.json"; META="$OUT/$CASE.settings.meta.json"
node "$SPIKE_DIR/gen-settings.mjs" "$CASEFILE" "$SETTINGS"
mf() { node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const v=m[process.argv[2]]; console.log(typeof v==="string"?v:JSON.stringify(v));' "$META" "$1"; }
CWD=$(mf cwd); PATHMODE=$(mf pathMode); HOOKLOG=$(mf hookLog); SPIKE=$(mf spike)
CWD_REAL=$(cd "$CWD" && pwd -P)
assert_under_root "$CWD_REAL"
case "$CWD_REAL" in "$REAL_HOME"/.claude*) die "cwd under a Claude config directory";; esac
while IFS= read -r d; do [ -n "$d" ] && { assert_under_root "$d"; mkdir -p "$d"; }; done < <(node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).mkdirs.forEach(d=>console.log(d))' "$META")

BASE_PATH=/usr/bin:/bin:/opt/homebrew/bin
EXTRA_PATH=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).extraPath.join(":"))' "$META")
[ "$PATHMODE" = gsd-first ] && RUN_PATH="$GSD_CORE/bin:$BASE_PATH" || RUN_PATH="$BASE_PATH"
[ -n "$EXTRA_PATH" ] && RUN_PATH="$RUN_PATH:$EXTRA_PATH"

ENVARR=(PATH="$RUN_PATH" HOME="$HOME" USER="${USER:-$(id -un)}" LOGNAME="${LOGNAME:-${USER:-$(id -un)}}" LANG=en_US.UTF-8 TMPDIR="${TMPDIR:-/tmp}" "${SAFE_GIT_ENV[@]}"
        CLAUDE_CODE_SUBAGENT_MODEL=haiku)   # spike cost control: subagents must not select a dearer model
[ -n "${CLAUDE_CONFIG_DIR:-}" ] && ENVARR+=(CLAUDE_CONFIG_DIR="$CLAUDE_CONFIG_DIR")
while IFS= read -r kv; do [ -n "$kv" ] && ENVARR+=("$kv"); done < <(node -e 'const e=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).env; for (const [k,v] of Object.entries(e)) console.log(`${k}=${v}`)' "$META")

PROMPT_EXPANDED=$(P="$PROMPT" F="$SPIKE_ROOT/preamble-line.txt" node -e 'const fs=require("fs");const pre=fs.existsSync(process.env.F)?fs.readFileSync(process.env.F,"utf8").split("\n")[0]:"";process.stdout.write(process.env.P.split("{PREAMBLE}").join(pre))')
rm -f "$OUT/$CASE.jsonl" "$OUT/$CASE.err" "$HOOKLOG"
START=$(date +%s)
(
  cd "$CWD_REAL"
  exec env -i "${ENVARR[@]}" "$CLAUDE_BIN" -p "$PROMPT_EXPANDED" --setting-sources "" --settings "$SETTINGS" \
    --permission-mode dontAsk --permission-prompts none --strict-mcp-config --model haiku \
    --max-budget-usd "$BUDGET" --output-format stream-json --verbose ${EXTRA[@]+"${EXTRA[@]}"}
) < /dev/null > "$OUT/$CASE.jsonl" 2> "$OUT/$CASE.err" &
PID=$!
( sleep "$MAXSEC"; kill -TERM "$PID" 2>/dev/null; sleep 5; kill -KILL "$PID" 2>/dev/null ) >/dev/null 2>&1 &
WD=$!
RC=0; wait "$PID" || RC=$?
kill "$WD" 2>/dev/null || true; wait "$WD" 2>/dev/null || true
WALL=$(( $(date +%s) - START ))

node "$SPIKE_DIR/summarize.mjs" "$OUT/$CASE.jsonl" "$HOOKLOG" > "$OUT/$CASE.digest.json"
node -e '
const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const cost=d.result?.total_cost_usd; const assumed=typeof cost!=="number";
const row={case:process.argv[2],spike:process.argv[3],costUsd:assumed?Number(process.argv[4]):cost,capUsd:Number(process.argv[4]),assumed,exit:Number(process.argv[5]),wallSeconds:Number(process.argv[6]),at:new Date().toISOString()};
fs.appendFileSync(process.argv[7],JSON.stringify(row)+"\n"); console.log(JSON.stringify(row));
' "$OUT/$CASE.digest.json" "$CASE" "$SPIKE" "$BUDGET" "$RC" "$WALL" "$LEDGER"
exit 0
