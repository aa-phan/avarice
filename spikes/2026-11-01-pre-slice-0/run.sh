#!/bin/bash
# usage: run.sh NAME HOOKMODE "PROMPT" [extra claude flags...]
S=/Users/aphan/.claude-edu/jobs/7fea7089/tmp/spikes; NAME=$1 MODE=$2 PROMPT=$3; shift 3
python3 -I $S/bin/gen.py $S $NAME $MODE
rm -f $S/out/$NAME.hook.log
cd ${REPO:-$S/repo} && git checkout -q -- . && git clean -qfd
claude -p "$PROMPT" --setting-sources "" --settings $S/out/$NAME.settings.json \
  --permission-mode dontAsk ${PP---permission-prompts none} --strict-mcp-config \
  --model haiku --max-budget-usd 0.40 --output-format stream-json --verbose "$@" \
  > $S/out/$NAME.jsonl 2> $S/out/$NAME.err
echo "exit=$?"
