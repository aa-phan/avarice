// One of the two competing processes of test/fault/approval-consume.test.ts (plan 04-16; T-04-42). It opens the store of the profile, waits for the start
// time of each round, and tries to consume the approval of that round. It prints one JSON line per round: the approval it consumed, or null, and when it left the barrier,
// when it called the store and when the call returned (`leftBarrierAt`, `calledAt`, `returnedAt`), so the test can show that the two processes' calls overlapped.
//
//   node approval-consume-child.ts <state.db> <scope> <action> <label> <rounds-json>
//
// `rounds-json` is a list of `{ digest, startAtMs }`. Every round of both processes names the same start time, so the two reach the ledger together.
// `node --test` with no file list also loads every file under test/; under the runner NODE_TEST_CONTEXT is set (the race test deletes it for its real
// children), so the helper does nothing there.
import { SqliteLedger } from '../../src/adapters/sqlite/ledger.ts';
import { openDb } from '../../src/adapters/sqlite/db.ts';

// Milliseconds since the epoch with a fraction, from the process start time and the monotonic clock: comparable between the two processes and finer than a millisecond,
// which a call to the store can finish within.
const epochMs = (): number => performance.timeOrigin + performance.now();

function main(): void {
  const [dbPath, scope, action, label, roundsJson] = process.argv.slice(2) as [string, string, string, string, string];
  const rounds = JSON.parse(roundsJson) as Array<{ digest: string; startAtMs: number }>;

  const opened = openDb(dbPath);
  if (!opened.ok) {
    process.stderr.write(`cannot open the store: ${JSON.stringify(opened.error)}\n`);
    process.exit(2);
  }
  const ledger = new SqliteLedger(opened.value, (prefix) => `${prefix}child_${label}`);

  for (const round of rounds) {
    while (Date.now() < round.startAtMs) {
      // spin: the two processes leave this loop within a millisecond of each other
    }
    const leftBarrierAt = epochMs();
    const nowMs = Date.now();
    const calledAt = epochMs();
    const consumed = ledger.consumeApprovalAndStart({
      scope,
      action,
      paramsDigest: round.digest,
      nowMs,
      startEvent: { type: 'action.started', runId: scope, data: { scope, action, paramsDigest: round.digest, source: 'approval', label } },
    });
    const returnedAt = epochMs();
    process.stdout.write(`${JSON.stringify({ label, digest: round.digest, consumed: consumed.ok ? (consumed.value?.approvalId ?? null) : `error:${consumed.error.kind}`, leftBarrierAt, calledAt, returnedAt })}\n`);
  }
  opened.value.close();
}

if (process.env['NODE_TEST_CONTEXT'] === undefined) main();
