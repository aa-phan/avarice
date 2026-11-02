// Logs every hook invocation; mode via HOOK_MODE env: log | crash | sleep
const fs = require('fs');
let input = '';
process.stdin.on('data', d => input += d).on('end', () => {
  fs.appendFileSync(process.argv[2], JSON.stringify({t: Date.now(), event: process.argv[3], input: JSON.parse(input || '{}')}) + '\n');
  const mode = process.argv[4] || 'log';
  if (mode === 'crash') throw new Error('hook crash');
  if (mode === 'sleep') setTimeout(() => {}, 60000);
});
