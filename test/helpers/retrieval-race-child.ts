// One of the six competing processes of test/fault/retrieval-race.test.ts (plan 04-28; CON-11, CS-16, T-04-78). It opens the store of the profile, waits for the start time of
// its round, and asks the retrieval guard of the run for a number of searches. It prints one JSON line per attempt: whether the search was granted, and the rule if it was not.
//
//   node retrieval-race-child.ts <state.db> <runId> <label> <attempts> <startAtMs>
//
// All six processes name the same start time, so their first attempts reach the ledger together. `node --test` with no file list also loads every file under test/; under the
// runner NODE_TEST_CONTEXT is set (the race test deletes it for its real children), so the helper does nothing there.
import { SqliteLedger } from '../../src/adapters/sqlite/ledger.ts';
import { openDb } from '../../src/adapters/sqlite/db.ts';
import { RetrievalGuard } from '../../src/app/retrieval-guard.ts';
import { RETRIEVAL_CAPS, effectiveCaps } from '../../src/domain/retrieval-rules.ts';

function main(): void {
  const [dbPath, runId, label, attemptsText, startText] = process.argv.slice(2) as [string, string, string, string, string];
  const opened = openDb(dbPath);
  if (!opened.ok) {
    process.stderr.write(`cannot open the store: ${JSON.stringify(opened.error)}\n`);
    process.exit(2);
  }
  const ledger = new SqliteLedger(opened.value, (prefix) => `${prefix}child_${label}`);
  // The guard of the run as production builds it, minus the profile: the caps are the defaults and the counted limits are the rows the parent stored.
  const guard = new RetrievalGuard(effectiveCaps({ ...RETRIEVAL_CAPS }, { searches: 10, fullReads: RETRIEVAL_CAPS.fullReads, fullReadBytes: RETRIEVAL_CAPS.fullReadBytes }), { ledger, runId });
  const startAtMs = Number(startText);
  while (Date.now() < startAtMs) {
    // spin: the processes leave this loop within a millisecond of each other
  }
  for (let i = 0; i < Number(attemptsText); i += 1) {
    const verdict = guard.beginSearch('scoped');
    const line = verdict.ok ? { label, granted: verdict.value.granted, ...(verdict.value.granted ? {} : { rule: verdict.value.rule }) } : { label, granted: false, error: verdict.error.kind };
    process.stdout.write(`${JSON.stringify(line)}\n`);
  }
  opened.value.close();
}

if (process.env['NODE_TEST_CONTEXT'] === undefined) main();
