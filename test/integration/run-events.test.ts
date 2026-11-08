// Correlation identifiers on the events of a run (plan 02-13; OPS-2, docs/contracts-and-state.md "Correlation identifiers"): every event of
// a run can be traced to its run, its attempt and its invocation. The run is a whole one (start --wait to ready_for_review with the fake run
// host driving the real hook entry), so the rows come from every writer a run has: the ledger, the stages, the budget code and the hook.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { FIXED_SLUG, RUN_CONVENTIONS_WITH_COMMANDS, commitConventions, ledgerRows, makeRunRepo, onboardRunRepo, startWithFakeRunHost, writeBrief } from '../helpers/run-fixtures.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

interface EventRow {
  seq: number;
  type: string;
  run_id: string | null;
  attempt_id: string | null;
  invocation_id: string | null;
  data_json: string;
}

const RUN_TYPES = ['run.', 'work_item.', 'invocation.', 'hook.', 'check.', 'gate.', 'handoff.', 'containment.'];

describe('every event of a run carries its correlation identifiers (OPS-2)', () => {
  const roots: CliRoots = makeRoots();
  const repo = makeRunRepo();
  cleanup.push(roots.base, repo.base);
  onboardRunRepo(roots, repo);
  commitConventions(repo, RUN_CONVENTIONS_WITH_COMMANDS);
  const brief = writeBrief(join(roots.base, 'briefs'));
  const result = startWithFakeRunHost(roots, repo, brief, { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' });
  const runId = /^run (run_[0-9A-Z]{26}): /.exec(result.stdout.split('\n')[0] ?? '')?.[1] as string;

  // The run's own events: everything after its creation (the onboarding before it has its own owner IDs).
  const created = (): number => ledgerRows<{ seq: number }>(roots, "SELECT seq FROM events WHERE type = 'run.created' AND run_id = ?", runId)[0]?.seq as number;
  const events = (): EventRow[] => ledgerRows<EventRow>(roots, 'SELECT seq, type, run_id, attempt_id, invocation_id, data_json FROM events WHERE seq >= ? ORDER BY seq', created());
  const ofRun = (): EventRow[] => events().filter((e) => RUN_TYPES.some((prefix) => e.type.startsWith(prefix)));

  it('the run reached ready_for_review (the rows below are those of a whole run)', () => {
    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.ok(runId, 'the run ID is printed');
  });

  it('every run., work_item., invocation., hook., check., gate., handoff. and containment. event has run_id equal to the run ID', () => {
    const rows = ofRun();
    assert.ok(rows.length > 20, `${rows.length} rows checked`);
    const wrong = rows.filter((e) => e.run_id !== runId).map((e) => `${e.seq} ${e.type} run_id=${String(e.run_id)}`);
    assert.deepEqual(wrong, [], `${rows.length} rows checked`);
    const types = new Set(rows.map((e) => e.type.split('.')[0]));
    for (const family of ['run', 'work_item', 'invocation', 'hook', 'check', 'gate', 'handoff']) assert.ok(types.has(family), `a ${family}. event exists, so the rule is checked on real rows`);
  });

  it('every invocation. and hook. event has invocation_id, and the hook rows name the invocation that finished', () => {
    const rows = ofRun().filter((e) => e.type.startsWith('invocation.') || e.type.startsWith('hook.'));
    assert.ok(rows.length > 5, `${rows.length} rows checked`);
    assert.deepEqual(rows.filter((e) => e.invocation_id === null).map((e) => `${e.seq} ${e.type}`), []);
    const finished = ofRun().filter((e) => e.type === 'invocation.finished');
    assert.equal(finished.length, 1, 'one unit, one invocation.finished');
    const hooks = rows.filter((e) => e.type.startsWith('hook.'));
    assert.ok(hooks.length > 0 && hooks.every((e) => e.invocation_id === finished[0]?.invocation_id), 'the hook decisions are those of that invocation');
  });

  it('every invocation.finished event has attempt_id, and so do the events that happen inside the attempt', () => {
    const rows = ofRun();
    const finished = rows.filter((e) => e.type === 'invocation.finished');
    assert.ok(finished.length > 0);
    assert.deepEqual(finished.filter((e) => e.attempt_id === null).map((e) => e.seq), []);
    const attemptId = finished[0]?.attempt_id as string;
    const inside = rows.filter((e) => ['check.finished', 'handoff.fetched', 'work_item.transition'].includes(e.type) || (e.type === 'gate.result' && !(JSON.parse(e.data_json) as { gate: string }).gate.startsWith('G0')));
    assert.ok(inside.length >= 6, `${inside.length} rows checked`);
    assert.deepEqual(inside.filter((e) => e.attempt_id !== attemptId).map((e) => `${e.seq} ${e.type} attempt=${String(e.attempt_id)}`), [], 'one attempt, named by every event inside it');
  });

  it('a blocked ending keeps the identifiers too: the decision, the finding and the transition name the run and the attempt', () => {
    const r = makeRoots();
    const bad = makeRunRepo();
    cleanup.push(r.base, bad.base);
    onboardRunRepo(r, bad);
    commitConventions(bad, RUN_CONVENTIONS_WITH_COMMANDS);
    const b = writeBrief(join(r.base, 'briefs'));
    const out = startWithFakeRunHost(r, bad, b, { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, strayWrite: { 'README.md': 'smuggled\n' } });
    const id = /^run (run_[0-9A-Z]{26}): /.exec(out.stdout.split('\n')[0] ?? '')?.[1] as string;
    const start = ledgerRows<{ seq: number }>(r, "SELECT seq FROM events WHERE type = 'run.created' AND run_id = ?", id)[0]?.seq as number;
    const rows = ledgerRows<EventRow>(r, 'SELECT seq, type, run_id, attempt_id, invocation_id, data_json FROM events WHERE seq >= ? ORDER BY seq', start);
    for (const type of ['containment.finding', 'decision.opened', 'gate.result']) {
      const found = rows.filter((e) => e.type === type && (type !== 'gate.result' || (JSON.parse(e.data_json) as { gate: string }).gate === 'G2'));
      assert.ok(found.length >= 1, `a ${type} event`);
      assert.ok(found.every((e) => e.run_id === id && e.attempt_id !== null), `${type} names the run and the attempt`);
    }
    const blocked = rows.find((e) => e.type === 'run.transition' && (JSON.parse(e.data_json) as { to: string }).to === 'blocked_on_decision');
    assert.equal(blocked?.run_id, id);
    assert.notEqual(blocked?.attempt_id, null);
  });
});
