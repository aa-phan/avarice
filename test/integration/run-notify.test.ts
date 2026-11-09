// Local notification of a stopped run (plan 03-16; D-21, D-22, D-24; AUT-4, AUT-6). The tracer drives the real CLI: a run whose unit pauses
// ends blocked_on_decision, the supervisor raises one banner through the Notifier port and the osascript adapter, and the ledger records
// it as delivered. osascript is a fake script (test/helpers/fake-osascript.mjs), so no test ever posts a real banner.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { REPO_ROOT, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { TEST_CLI } from '../helpers/offline.ts';
import { RUN_CONVENTIONS, commitConventions, makeRunRepo, onboardRunRepo, writeBrief } from '../helpers/run-fixtures.ts';
import { configPathFor } from '../../src/adapters/fs/profile-paths.ts';

const FAKE_OSASCRIPT = join(REPO_ROOT, 'test', 'helpers', 'fake-osascript.mjs');
const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function rows<T>(roots: CliRoots, sql: string, ...params: Array<string | number>): T[] {
  const handle = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true, timeout: 5000 });
  try {
    return (handle.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    handle.close();
  }
}

async function until<T>(what: string, read: () => T | undefined, limitMs = 30_000): Promise<T> {
  const end = Date.now() + limitMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// The profile config is hand-edited JSON; resolveProfile leaves an existing file alone.
function writeProfileConfig(roots: CliRoots, extra: Record<string, unknown>): void {
  const path = configPathFor(roots.AVARICE_CONFIG_HOME, 'personal-local');
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify({ schema: 1, profile: 'personal-local', dataRoot: roots.AVARICE_DATA_ROOT, workRoot: roots.AVARICE_WORK_ROOT, ...extra }, null, 2)}\n`, { mode: 0o600 });
}

const CONVENTIONS = { ...RUN_CONVENTIONS, agentCommands: ['npm test'] };

describe('a run that stops blocked_on_decision raises one banner (tracer; AUT-6, SC2)', () => {
  const roots = makeRoots();
  const repo = makeRunRepo();
  cleanup.push(roots.base, repo.base);
  const logDir = mkdtempSync(join(tmpdir(), 'avarice-run-notify-'));
  cleanup.push(logDir);
  const log = join(logDir, 'osascript.log');
  chmodSync(FAKE_OSASCRIPT, 0o755);
  writeProfileConfig(roots, { notify: { local: { osascriptPath: FAKE_OSASCRIPT } } });
  onboardRunRepo(roots, repo);
  commitConventions(repo, CONVENTIONS);
  const brief = writeBrief(join(roots.base, 'briefs'));
  const question = 'Which approach should the slug take?\n1. strip the dashes at both ends\n2. keep them';
  const env = { AVARICE_FAKE_HOST: JSON.stringify({ run: { question, summary: false } }), AVARICE_TEST_NOTIFIER: 'local', FAKE_OSASCRIPT_LOG: log };
  const started = runCli(['start', '--brief', brief, '--policy', 'routine', '--wait'], { roots, cwd: repo.path, entry: TEST_CLI, env, timeoutMs: 300_000 });
  const runId = /^run (run_[0-9A-Z]{26}): /.exec(started.stdout.split('\n')[0] ?? '')?.[1] as string;

  it('ends blocked_on_decision with one open decision', () => {
    assert.equal(started.code, 3, started.stderr + started.stdout);
    assert.ok(runId, 'the first line names the run');
    assert.deepEqual(rows<{ state: string; reason: string }>(roots, 'SELECT state, reason FROM runs WHERE run_id = ?', runId), [{ state: 'blocked_on_decision', reason: 'decision' }]);
    assert.equal(rows(roots, "SELECT 1 FROM decisions WHERE run_id = ? AND state = 'open'", runId).length, 1);
  });

  it('records one decisions notification for the local destination with the decision as subject, delivered on the first attempt', async () => {
    await until('the notification to be delivered', () => (rows(roots, "SELECT 1 FROM notifications WHERE state = 'delivered'").length === 1 ? true : undefined));
    const decisionId = rows<{ decision_id: string }>(roots, 'SELECT decision_id FROM decisions WHERE run_id = ?', runId)[0]?.decision_id as string;
    const notifications = rows<{ run_id: string; kind: string; destination: string; subject_ids_json: string; state: string; attempts: number; last_error: string | null }>(roots, 'SELECT * FROM notifications');
    assert.equal(notifications.length, 1);
    const n = notifications[0] as (typeof notifications)[number];
    assert.deepEqual([n.run_id, n.kind, n.destination, n.state, n.attempts, n.last_error], [runId, 'decisions', 'local', 'delivered', 1, null]);
    assert.deepEqual(JSON.parse(n.subject_ids_json), [decisionId]);
    const events = rows<{ data_json: string }>(roots, "SELECT data_json FROM events WHERE type = 'notify.delivered'");
    assert.equal(events.length, 1);
  });

  it('gave the fixed -e lines, then `--`, then the body and the title as separate arguments', () => {
    const lines = readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1, 'one banner');
    assert.deepEqual(JSON.parse(lines[0] as string), [
      '-e',
      'on run argv',
      '-e',
      'display notification (item 1 of argv) with title (item 2 of argv)',
      '-e',
      'end run',
      '--',
      `${runId}: 1 decision waiting. Run: avarice inbox`,
      'AVARICE',
    ]);
  });

  it('leaves the decision in `inbox`', () => {
    const decisionId = rows<{ decision_id: string }>(roots, 'SELECT decision_id FROM decisions WHERE run_id = ?', runId)[0]?.decision_id as string;
    const inbox = runCli(['inbox', '--json'], { roots, entry: TEST_CLI });
    assert.equal(inbox.code, 0, inbox.stderr);
    assert.ok(inbox.stdout.includes(decisionId), 'the inbox lists the decision');
    assert.ok(existsSync(log));
  });
});
