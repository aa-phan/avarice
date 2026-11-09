// The model per invocation (plan 03-17; D-10, RC-8, S-51): each run invocation is launched with its item's model (the size picks it under the
// default modelBySize: small haiku, medium sonnet, large opus; an explicit model wins) and the ledger records it on the launch:run step and on
// the invocation.finished event, so a run's model use is traceable per invocation. The fake run host records the request it was given; every
// other part (git, the sandboxed checks, the ledger, the supervisor) is real. No test calls a real model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { BriefItem } from '../../src/domain/brief.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import {
  FIXED_SLUG,
  RUN_CONVENTIONS_WITH_COMMANDS,
  commitConventions,
  ledgerRows,
  makeRunRepo,
  onboardRunRepo,
  runInProcess,
  writeItemsBrief,
} from '../helpers/run-fixtures.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const HELPER = 'export const helper = 1;\n';
const ACCEPTANCE: readonly string[] = ['Repeated separators collapse to one dash | verifiedBy: check:test', 'The helper module exists | verifiedBy: check:test'];
const FIX: FakeRunOptions = { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' };
const ADD_HELPER: FakeRunOptions = { edits: { 'src/helper.ts': HELPER }, summary: true, verification: 'passed' };

interface Played {
  roots: CliRoots;
  runId: string;
  state: string;
  // The model of each invocation the host was given, in order, with the item its prompt named.
  hostCalls: Array<{ item: string; model: string }>;
}

async function play(items: readonly BriefItem[], run: FakeRunOptions): Promise<Played> {
  const roots = makeRoots();
  const repo = makeRunRepo();
  cleanup.push(roots.base, repo.base);
  onboardRunRepo(roots, repo);
  commitConventions(repo, RUN_CONVENTIONS_WITH_COMMANDS);
  const brief = writeItemsBrief(join(roots.base, 'briefs'), items, ACCEPTANCE);
  const done = await runInProcess(roots, repo, brief, run);
  const hostCalls = done.host.calls.map((call) => ({ item: /^Work item ([A-Z][A-Za-z0-9_-]*)/m.exec(call.prompt)?.[1] ?? '?', model: call.model }));
  return { roots, runId: done.runId, state: done.state, hostCalls };
}

interface StepRow {
  attempt: number;
  status: string;
  result_json: string;
}

// The launch:run steps of the run that finished (a step is stored per attempt; the started record is replaced by its completion).
function launchSteps(p: Played): Array<{ itemId: string; model: unknown; status: string }> {
  return ledgerRows<StepRow>(p.roots, "SELECT attempt, status, result_json FROM run_steps WHERE run_id = ? AND step = 'launch:run' ORDER BY rowid", p.runId).map((row) => {
    const result = JSON.parse(row.result_json) as { itemId: string; model?: unknown };
    return { itemId: result.itemId, model: result.model, status: row.status };
  });
}

function finishedEvents(p: Played): Array<{ itemId: string; model: unknown }> {
  return ledgerRows<{ data_json: string }>(p.roots, "SELECT data_json FROM events WHERE type = 'invocation.finished' AND run_id = ? ORDER BY seq", p.runId).map((row) => {
    const data = JSON.parse(row.data_json) as { itemId: string; model?: unknown };
    return { itemId: data.itemId, model: data.model };
  });
}

describe('the size of an item picks its model, and the model is recorded per invocation (S-51, RC-8, D-10)', () => {
  const items: readonly BriefItem[] = [
    { id: 'A', title: 'Collapse repeated dashes', dependsOn: [], size: 'small', acceptance: ['AC1'] },
    { id: 'B', title: 'Add a helper module', dependsOn: [], size: 'large', acceptance: ['AC2'] },
  ];
  let played: Played;

  it('launches the small item with haiku and the large one with opus', async () => {
    played = await play(items, { perItem: { A: FIX, B: ADD_HELPER } });
    assert.equal(played.state, 'ready_for_review');
    assert.deepEqual(played.hostCalls, [
      { item: 'A', model: 'haiku' },
      { item: 'B', model: 'opus' },
    ]);
  });

  it('records the model on the launch:run step of each invocation', () => {
    assert.deepEqual(
      launchSteps(played).map((s) => [s.itemId, s.model, s.status]),
      [
        ['A', 'haiku', 'completed'],
        ['B', 'opus', 'completed'],
      ],
    );
  });

  it('records the model on every invocation.finished event of the run', () => {
    const events = finishedEvents(played);
    assert.equal(events.length, 2);
    assert.deepEqual(
      events.map((e) => [e.itemId, e.model]),
      [
        ['A', 'haiku'],
        ['B', 'opus'],
      ],
    );
    assert.ok(events.every((e) => typeof e.model === 'string' && e.model !== ''), 'no invocation.finished event lacks its model');
  });
});

describe('an explicit model wins over the size (RC-8)', () => {
  it('runs an item with size small and model opus on opus', async () => {
    const items: readonly BriefItem[] = [
      { id: 'A', title: 'Collapse repeated dashes', dependsOn: [], size: 'small', model: 'opus', acceptance: ['AC1'] },
      { id: 'B', title: 'Add a helper module', dependsOn: [], acceptance: ['AC2'] },
    ];
    const p = await play(items, { perItem: { A: FIX, B: ADD_HELPER } });
    assert.equal(p.state, 'ready_for_review');
    assert.deepEqual(p.hostCalls, [
      { item: 'A', model: 'opus' },
      { item: 'B', model: 'sonnet' },
    ]);
    assert.deepEqual(
      finishedEvents(p).map((e) => [e.itemId, e.model]),
      [
        ['A', 'opus'],
        ['B', 'sonnet'],
      ],
    );
  });
});

describe('a retried unit uses the model of its item\'s first unit (RC-8 ordering, CON-16)', () => {
  it('runs a crashed unit of a small item and its retry both on haiku, and the next item on its own model', async () => {
    const items: readonly BriefItem[] = [
      { id: 'A', title: 'Collapse repeated dashes', dependsOn: [], size: 'small', acceptance: ['AC1'] },
      { id: 'B', title: 'Add a helper module', dependsOn: [], size: 'large', acceptance: ['AC2'] },
    ];
    const p = await play(items, { perItem: { A: { perAttempt: [{ crash: { afterFiles: ['src/extra.ts'] } }, FIX] }, B: ADD_HELPER } });
    assert.equal(p.state, 'ready_for_review');
    assert.deepEqual(p.hostCalls, [
      { item: 'A', model: 'haiku' },
      { item: 'A', model: 'haiku' },
      { item: 'B', model: 'opus' },
    ]);
    assert.deepEqual(
      finishedEvents(p).map((e) => [e.itemId, e.model]),
      [
        ['A', 'haiku'],
        ['A', 'haiku'],
        ['B', 'opus'],
      ],
    );
    assert.deepEqual(
      launchSteps(p).map((s) => [s.itemId, s.model]),
      [
        ['A', 'haiku'],
        ['A', 'haiku'],
        ['B', 'opus'],
      ],
    );
  });
});
