// The multi-item kernel (plan 03-14; D-08, D-09, AUT-3, AUT-16, RC-8): a run with several work items goes from `start --wait` to
// `ready_for_review` with the fake run host, one unit, one G2 and one supervisor commit per item, items in dependency and declaration order.
// The fake host plays one script per item (FakeRunOptions.perItem, selected by the `Work item <ID>:` line of the prompt). Everything else is
// real: git, the sandboxed checks, the ledger, the gates and the supervisor commit. No test calls a real model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { BriefItem } from '../../src/domain/brief.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import { RUN_EXPIRY_WAIT_MS, resumeRunCli, runRunWithFault, runSurvivorPidFile, sleepSync } from '../helpers/fault-run.ts';
import {
  FIXED_SLUG,
  RUN_CONVENTIONS,
  RUN_CONVENTIONS_WITH_COMMANDS,
  commitConventions,
  ledgerRows,
  makeRunRepo,
  onboardRunRepo,
  startWithFakeRunHost,
  writeItemsBrief,
} from '../helpers/run-fixtures.ts';
import { git } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
// Host processes a killed supervisor leaves running on purpose: ended in `after`.
const survivors: number[] = [];

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

after(() => {
  for (const pid of survivors) {
    if (!isAlive(pid)) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  pin: string;
  brief: string;
}

// Two required checks make a final pass that can be killed between them: `test` fails at the pin and passes once item A fixed the slug, `lint` always passes.
const TWO_CHECKS = { ...RUN_CONVENTIONS, checks: [...RUN_CONVENTIONS.checks, { name: 'lint', argv: ['node', 'scripts/lint-ok.mjs'], timeoutSec: 60, required: true }], agentCommands: ['npm test'] };

function fixture(conventions: unknown = RUN_CONVENTIONS_WITH_COMMANDS, items: readonly BriefItem[] = TWO_ITEMS, acceptance: readonly string[] = TWO_ACCEPTANCE): Fixture {
  const roots = makeRoots();
  const repo = makeRunRepo({ 'scripts/lint-ok.mjs': 'process.exit(0);\n' });
  cleanup.push(roots.base, repo.base);
  const pin = onboardRunRepo(roots, repo);
  commitConventions(repo, conventions);
  return { roots, repo, pin, brief: writeItemsBrief(join(roots.base, 'briefs'), items, acceptance) };
}

const HELPER = 'export const helper = 1;\n';
const SECOND = 'export const second = 2;\n';

const TWO_ITEMS: readonly BriefItem[] = [
  { id: 'A', title: 'Collapse repeated dashes', dependsOn: [], acceptance: ['AC1'] },
  { id: 'B', title: 'Add a helper module', dependsOn: [], acceptance: ['AC2'] },
];
const TWO_ACCEPTANCE: readonly string[] = ['Repeated separators collapse to one dash | verifiedBy: check:test', 'The helper module exists | verifiedBy: check:test'];

const runIdOf = (stdout: string): string => {
  const match = /^run (run_[0-9A-Z]{26}): /.exec(stdout.split('\n')[0] ?? '');
  assert.ok(match, `the first line names the run, got ${JSON.stringify(stdout.split('\n')[0])}`);
  return match[1] as string;
};
const lastLine = (stdout: string): string => stdout.trim().split('\n').at(-1) as string;

function start(f: Fixture, items: readonly BriefItem[], acceptance: readonly string[], run: FakeRunOptions): CliResult {
  const brief = writeItemsBrief(join(f.roots.base, 'briefs'), items, acceptance);
  return startWithFakeRunHost(f.roots, f.repo, brief, run as Record<string, unknown>);
}

interface Commit {
  subject: string;
  run: string | undefined;
  attempt: string | undefined;
}

// The commits the run branch carries on top of the pin, oldest first, with the trailers the supervisor wrote.
function commitsOf(f: Fixture, runId: string): Commit[] {
  const out = git(f.repo.path, ['log', '--reverse', '--format=%s%x1f%B%x1e', `${f.pin}..refs/heads/avarice/${runId}`]);
  return out
    .split('\x1e')
    .map((entry) => entry.replace(/^\n/, ''))
    .filter((entry) => entry.trim() !== '')
    .map((entry) => {
      const [subject = '', body = ''] = entry.split('\x1f');
      return { subject, run: /^Avarice-Run: (\S+)$/m.exec(body)?.[1], attempt: /^Avarice-Attempt: (\S+)$/m.exec(body)?.[1] };
    });
}

interface ItemRow {
  item_id: string;
  state: string;
  gsd_session: string | null;
}
const itemsOf = (f: Fixture, runId: string): ItemRow[] => ledgerRows<ItemRow>(f.roots, 'SELECT item_id, state, gsd_session FROM work_items WHERE run_id = ? ORDER BY rowid', runId);

interface AttemptDb {
  attempt_id: string;
  item_id: string | null;
  reason: string;
}
const attemptsOf = (f: Fixture, runId: string): AttemptDb[] => ledgerRows<AttemptDb>(f.roots, 'SELECT attempt_id, item_id, reason FROM attempts WHERE run_id = ? ORDER BY ordinal', runId);

const checkpointsOf = (f: Fixture, runId: string): string[] => ledgerRows<{ next_action: string }>(f.roots, 'SELECT next_action FROM checkpoints WHERE run_id = ? ORDER BY seq', runId).map((r) => r.next_action);

interface GateDb {
  gate: string;
  work_item: string | null;
  passed: number;
}
const gatesOf = (f: Fixture, runId: string): GateDb[] => ledgerRows<GateDb>(f.roots, "SELECT gate, work_item, passed FROM gate_results WHERE run_id = ? AND gate IN ('G2', 'G4') ORDER BY rowid", runId);

interface Observed {
  prompt: string;
  sessionId: string;
  observed: Record<string, string | null>;
}
const recorded = (path: string): Observed => JSON.parse(readFileSync(path, 'utf8')) as Observed;

describe('a two-item brief runs from start to ready_for_review, one unit, one G2 and one commit per item (tracer)', () => {
  const f = fixture();
  const recordA = join(f.roots.base, 'unit-A.json');
  const recordB = join(f.roots.base, 'unit-B.json');
  const result = start(f, TWO_ITEMS, TWO_ACCEPTANCE, {
    perItem: {
      A: { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed', recordTo: recordA, observe: ['.planning/config.json'] },
      B: { edits: { 'src/helper.ts': HELPER }, summary: true, verification: 'passed', recordTo: recordB, observe: ['.planning/config.json'] },
    },
  });
  const runId = runIdOf(result.stdout);

  it('ends ready_for_review with exit 0', () => {
    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.equal(lastLine(result.stdout), `run ${runId}: ready_for_review`);
  });

  it('commits each item separately: the subject is the item title, the trailers name the run and that item attempt', () => {
    const attempts = attemptsOf(f, runId);
    const commits = commitsOf(f, runId);
    assert.deepEqual(
      commits.map((c) => c.subject),
      ['Collapse repeated dashes', 'Add a helper module'],
    );
    assert.deepEqual(
      commits.map((c) => c.run),
      [runId, runId],
    );
    assert.deepEqual(
      commits.map((c) => c.attempt),
      attempts.map((a) => a.attempt_id),
    );
  });

  it('stores both work items, both done, and one attempt per item (reason initial)', () => {
    assert.deepEqual(
      itemsOf(f, runId).map((i) => [i.item_id, i.state]),
      [
        ['A', 'done'],
        ['B', 'done'],
      ],
    );
    assert.deepEqual(
      attemptsOf(f, runId).map((a) => [a.item_id, a.reason]),
      [
        ['A', 'initial'],
        ['B', 'initial'],
      ],
    );
  });

  it('judges each item at G2 on its own and the whole run once at G4, at the final commit, with no item named', () => {
    assert.deepEqual(gatesOf(f, runId), [
      { gate: 'G2', work_item: 'A', passed: 1 },
      { gate: 'G2', work_item: 'B', passed: 1 },
      { gate: 'G4', work_item: null, passed: 1 },
    ]);
    const itemChecks = ledgerRows<{ work_item: string | null; status: string }>(
      f.roots,
      "SELECT e.work_item, e.status FROM evidence e JOIN attempts a ON a.attempt_id = e.attempt_id WHERE a.run_id = ? AND e.kind = 'check' AND e.environment_json LIKE '%\"phase\":\"item\"%' ORDER BY e.rowid",
      runId,
    );
    assert.deepEqual(
      itemChecks.map((e) => [e.work_item, e.status]),
      [
        ['A', 'passed'],
        ['B', 'passed'],
      ],
      'the required check ran after each item, against the baseline delta',
    );
  });

  it('maps the acceptance criteria of both items at the final commit', () => {
    const final = ledgerRows<{ work_item: string | null; acceptance_json: string }>(
      f.roots,
      "SELECT e.work_item, e.acceptance_json FROM evidence e JOIN attempts a ON a.attempt_id = e.attempt_id WHERE a.run_id = ? AND e.kind = 'check' AND e.environment_json LIKE '%\"phase\":\"final\"%'",
      runId,
    );
    assert.ok(final.length > 0, 'the final pass recorded check evidence');
    assert.ok(final.every((e) => e.work_item === null), 'final evidence is run-level');
    const mapped = new Set(final.flatMap((e) => JSON.parse(e.acceptance_json) as string[]));
    assert.deepEqual([...mapped].sort(), ['AC1', 'AC2']);
  });

  it('gave each unit the GSD settings: .planning/config.json was present when both units started', () => {
    assert.ok(existsSync(recordA) && existsSync(recordB));
    assert.notEqual(recorded(recordA).observed['.planning/config.json'], null, 'item A');
    assert.notEqual(recorded(recordB).observed['.planning/config.json'], null, 'item B');
    assert.match(recorded(recordA).prompt, /Work item A: Collapse repeated dashes/);
    assert.match(recorded(recordB).prompt, /Work item B: Add a helper module/);
  });

  it('moves the run running -> running between the items and running -> verifying after the last', () => {
    const moves = ledgerRows<{ data_json: string }>(f.roots, "SELECT data_json FROM events WHERE run_id = ? AND type = 'run.transition' ORDER BY seq", runId)
      .map((e) => JSON.parse(e.data_json) as { from: string; to: string; nextAction: string })
      .filter((m) => m.from === 'running');
    assert.deepEqual(
      moves.map((m) => `${m.from}>${m.to} (${m.nextAction})`),
      ['running>running (context-pack)', 'running>verifying (verify:checks)'],
    );
    const betweenItems = ledgerRows<{ item_id: string | null }>(f.roots, "SELECT item_id FROM checkpoints WHERE run_id = ? AND from_state = 'running' AND to_state = 'running' AND next_action = 'context-pack' ORDER BY seq", runId);
    assert.ok(betweenItems.some((c) => c.item_id === 'B'), 'the move between the items names the item that starts next');
    // A transition names the next action and the stage then commits the same checkpoint before its side effect: a repeat collapses.
    const collapsed = checkpointsOf(f, runId).filter((action, index, all) => index === 0 || action !== all[index - 1]);
    assert.deepEqual(
      collapsed.filter((a) => ['launch:run', 'gate:g2', 'commit', 'verify:checks', 'gate:g4'].includes(a)),
      ['launch:run', 'gate:g2', 'commit', 'launch:run', 'gate:g2', 'commit', 'verify:checks', 'gate:g4'],
    );
  });
});

describe('items run in dependency order and each unit is delegated under its own session (D-09, D-08)', () => {
  it('B is declared first and depends on A: A runs first, then B, and the baseline attempt belongs to A', () => {
    const items: readonly BriefItem[] = [
      { id: 'B', title: 'Add a second module', dependsOn: ['A'], acceptance: ['AC1'] },
      { id: 'A', title: 'Collapse repeated dashes', dependsOn: [], acceptance: ['AC2'] },
    ];
    const acceptance = ['The second module exists | verifiedBy: check:test', 'Repeated separators collapse to one dash | verifiedBy: check:test'];
    const f = fixture(RUN_CONVENTIONS_WITH_COMMANDS, items, acceptance);
    const result = startWithFakeRunHost(f.roots, f.repo, f.brief, {
      perItem: {
        A: { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' },
        B: { edits: { 'src/second.ts': SECOND }, summary: true, verification: 'passed' },
      },
    });
    const runId = runIdOf(result.stdout);
    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.deepEqual(
      commitsOf(f, runId).map((c) => c.subject),
      ['Collapse repeated dashes', 'Add a second module'],
    );
    assert.deepEqual(
      attemptsOf(f, runId).map((a) => [a.item_id, a.reason]),
      [
        ['A', 'initial'],
        ['B', 'initial'],
      ],
    );
  });

  it('writes the session ID of each launch into work_items.gsd_session', () => {
    const f = fixture();
    const result = startWithFakeRunHost(f.roots, f.repo, f.brief, {
      perItem: {
        A: { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' },
        B: { edits: { 'src/helper.ts': HELPER }, summary: true, verification: 'passed' },
      },
    });
    const runId = runIdOf(result.stdout);
    assert.equal(result.code, 0, result.stderr + result.stdout);
    const launches = ledgerRows<{ result_json: string }>(f.roots, "SELECT result_json FROM run_steps WHERE run_id = ? AND step = 'launch:run' ORDER BY rowid", runId).map(
      (r) => JSON.parse(r.result_json) as { itemId: string; sessionId: string },
    );
    assert.deepEqual(
      launches.map((l) => l.itemId),
      ['A', 'B'],
    );
    const sessions = itemsOf(f, runId).map((i) => i.gsd_session);
    assert.deepEqual(
      sessions,
      launches.map((l) => l.sessionId),
    );
    assert.notEqual(sessions[0], sessions[1]);
  });
});

describe('a supervisor killed inside item B resumes item B, not item A (D-09, FR-7)', () => {
  const f = fixture();
  const A_UNIT: FakeRunOptions = { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' };
  const B_UNIT: FakeRunOptions = { edits: { 'src/helper.ts': HELPER }, summary: true, verification: 'passed' };
  const killed = runRunWithFault(f.roots, f.repo, f.brief, undefined, {
    perItem: { A: A_UNIT, B: { ...B_UNIT, killInUnit: { afterFiles: ['src/helper.ts'], survivorPidFile: runSurvivorPidFile(f.roots) } } },
  });
  const { runId } = killed;
  const survivor = Number(readFileSync(runSurvivorPidFile(f.roots), 'utf8').trim());
  survivors.push(survivor);

  it('item A is committed and item B is delegated when the supervisor dies', () => {
    assert.deepEqual(
      itemsOf(f, runId).map((i) => [i.item_id, i.state]),
      [
        ['A', 'done'],
        ['B', 'delegated'],
      ],
    );
    assert.ok(isAlive(survivor), 'the host of item B outlived its supervisor');
  });

  it('the resume reaps the host, discards item B to its snapshot, retries it once and the run is ready_for_review with both commits', () => {
    sleepSync(RUN_EXPIRY_WAIT_MS);
    const resumed = resumeRunCli(f.roots, runId, { perItem: { A: A_UNIT, B: B_UNIT } });
    assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
    assert.equal(lastLine(resumed.stdout), `run ${runId}: ready_for_review`);
    assert.equal(isAlive(survivor), false, 'the resume ended the host that carried the interrupted session');
    assert.deepEqual(
      attemptsOf(f, runId).map((a) => [a.item_id, a.reason]),
      [
        ['A', 'initial'],
        ['B', 'initial'],
        ['B', 'con16-retry'],
      ],
      'only item B was retried',
    );
    assert.deepEqual(
      commitsOf(f, runId).map((c) => c.subject),
      ['Collapse repeated dashes', 'Add a helper module'],
    );
    const discards = ledgerRows<{ result_json: string }>(f.roots, "SELECT result_json FROM run_steps WHERE run_id = ? AND step = 'discard'", runId).map((r) => JSON.parse(r.result_json) as { itemId: string });
    assert.deepEqual(
      discards.map((d) => d.itemId),
      ['B'],
    );
  });
});

describe('an interrupted final pass marks its unfinished checks for the run, not for an item (T-02-58, D-09)', () => {
  it('a supervisor killed between the two checks of the final pass: the resume inserts inconclusive evidence naming no item, and re-verifies', () => {
    const f = fixture(TWO_CHECKS);
    const units: FakeRunOptions = {
      perItem: {
        A: { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' },
        B: { edits: { 'src/helper.ts': HELPER }, summary: true, verification: 'passed' },
      },
    };
    const killed = runRunWithFault(f.roots, f.repo, f.brief, 'mid-verify', units);
    sleepSync(RUN_EXPIRY_WAIT_MS);
    const resumed = resumeRunCli(f.roots, killed.runId, units);
    assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
    assert.equal(lastLine(resumed.stdout), `run ${killed.runId}: ready_for_review`);
    const interrupted = ledgerRows<{ work_item: string | null; name: string; status: string }>(
      f.roots,
      "SELECT e.work_item, e.name, e.status FROM evidence e JOIN attempts a ON a.attempt_id = e.attempt_id WHERE a.run_id = ? AND e.status = 'inconclusive'",
      killed.runId,
    );
    assert.ok(interrupted.length > 0, 'the check that never finished is marked inconclusive');
    assert.ok(interrupted.every((e) => e.work_item === null), 'the rows name no item');
  });
});
