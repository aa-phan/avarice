#!/usr/bin/env node
// A stand-in for /bin/launchctl: a test hands it to the scheduler so no test registers anything with the real launchd.
// It appends its argument list, as one JSON line, to the file named by FAKE_LAUNCHCTL_LOG, then behaves as asked:
//   FAKE_LAUNCHCTL_EXIT          the exit code of every call (default 0)
//   FAKE_LAUNCHCTL_EXIT_BOOTOUT  the exit code of a `bootout` call, overriding the one above
import { appendFileSync } from 'node:fs';

const log = process.env.FAKE_LAUNCHCTL_LOG;
if (log !== undefined && log !== '') appendFileSync(log, `${JSON.stringify(process.argv.slice(2))}\n`);
const bootout = process.argv[2] === 'bootout' ? process.env.FAKE_LAUNCHCTL_EXIT_BOOTOUT : undefined;
process.exitCode = Number(bootout ?? process.env.FAKE_LAUNCHCTL_EXIT ?? 0);
