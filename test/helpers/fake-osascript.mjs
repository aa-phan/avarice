#!/usr/bin/env node
// A stand-in for /usr/bin/osascript: a test points notify.local.osascriptPath at this file so no real banner is ever posted.
// It appends its argument list, as one JSON line, to the file named by FAKE_OSASCRIPT_LOG, then behaves as asked:
//   FAKE_OSASCRIPT_EXIT      the exit code (default 0)
//   FAKE_OSASCRIPT_SLEEP_MS  wait this long before exiting (a call that outlives the adapter's timeout)
import { appendFileSync } from 'node:fs';

const log = process.env.FAKE_OSASCRIPT_LOG;
if (log !== undefined && log !== '') appendFileSync(log, `${JSON.stringify(process.argv.slice(2))}\n`);
const wait = Number(process.env.FAKE_OSASCRIPT_SLEEP_MS ?? 0);
if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
process.exitCode = Number(process.env.FAKE_OSASCRIPT_EXIT ?? 0);
