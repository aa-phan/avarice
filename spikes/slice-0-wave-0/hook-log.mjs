#!/usr/bin/env node
// PreToolUse hook for the Wave 0 spikes: hook-log.mjs LOG MODE [PREAMBLE_FILE]
//   log             record every hook input, make no decision
//   allow-preamble  record, and allow a Bash call whose first line equals the recorded GSD preamble line
//   deny-all        record, and deny every call
import fs from 'node:fs';

const [log, mode = 'log', preambleFile] = process.argv.slice(2);
let raw = '';
process.stdin.on('data', (d) => { raw += d; }).on('end', () => {
  const input = JSON.parse(raw || '{}');
  let decision = 'none';
  let reason = '';
  if (mode === 'deny-all') { decision = 'deny'; reason = 'spike deny-all'; }
  if (mode === 'allow-preamble' && input.tool_name === 'Bash' && preambleFile) {
    const want = fs.readFileSync(preambleFile, 'utf8').split('\n')[0];
    const got = String(input.tool_input?.command ?? '').split('\n')[0];
    if (got === want) { decision = 'allow'; reason = 'first line equals the recorded GSD preamble'; }
  }
  fs.appendFileSync(log, JSON.stringify({ t: Date.now(), decision, reason, input }) + '\n');
  if (decision !== 'none') {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason } }));
  }
});
