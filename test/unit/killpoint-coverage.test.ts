// Kill-point coverage of the run lifecycle (plan 03-26; AC-3, NFR-6, FR-7). Every action the running, verifying and paused stages write as a checkpoint (RUN_NEXT_ACTIONS) must
// have a kill point, so a crash after it is committed is proven to resume to the uninterrupted result. The points live in several lists on purpose, because the main kill
// suite (test/fault/run-killpoints.test.ts) runs every RUN_KILL_POINTS entry against one reference run, and a point that only a different scenario reaches would fail it:
//
//   RUN_KILL_POINTS        the points a single uninterrupted-start run reaches (the preparation, the item loop, the commit, the verification and the hand-off)
//   PARK_KILL_POINTS       an item that stops to ask: `park`, `mid-park` and `after-release:blocked` (test/fault/run-park.test.ts)
//   RESUME_KILL_POINTS     an answered item that resumes its own session: `unpark`, `mid-unpark` and `mid-invocation:run` of the resumed unit (test/fault/run-resume-session.test.ts)
//   CANCEL_KILL_POINTS     a cancel of a run: `after-cancel-request` and `mid-cancel` (test/fault/run-cancel.test.ts)
//   RECONCILE_KILL_POINTS  a resume that is itself killed while it reconciles: the `paused` stage's `reconcile` (test/fault/run-reconcile.test.ts)
//
// This test is the one place that checks the union, and that each list has a suite that exercises it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RUN_NEXT_ACTIONS } from '../../src/domain/run-lifecycle.ts';
import { CANCEL_KILL_POINTS, PARK_KILL_POINTS, RECONCILE_KILL_POINTS, RESUME_KILL_POINTS, RUN_KILL_POINTS } from '../helpers/fault-run.ts';
import { REPO_ROOT } from '../helpers/run-cli.ts';

const LISTS: ReadonlyArray<{ name: string; points: readonly string[]; suite: string }> = [
  { name: 'RUN_KILL_POINTS', points: RUN_KILL_POINTS, suite: 'test/fault/run-killpoints.test.ts' },
  { name: 'PARK_KILL_POINTS', points: PARK_KILL_POINTS, suite: 'test/fault/run-park.test.ts' },
  { name: 'RESUME_KILL_POINTS', points: RESUME_KILL_POINTS, suite: 'test/fault/run-resume-session.test.ts' },
  { name: 'CANCEL_KILL_POINTS', points: CANCEL_KILL_POINTS, suite: 'test/fault/run-cancel.test.ts' },
  { name: 'RECONCILE_KILL_POINTS', points: RECONCILE_KILL_POINTS, suite: 'test/fault/run-reconcile.test.ts' },
];
const UNION = new Set(LISTS.flatMap((l) => l.points));
const STAGES = ['running', 'verifying', 'paused'] as const;

// The checkpoints a stage writes that the main kill suite cannot reach, and the list that holds each one.
const OTHER_LIST: Readonly<Record<string, string>> = { park: 'PARK_KILL_POINTS', unpark: 'RESUME_KILL_POINTS', reconcile: 'RECONCILE_KILL_POINTS' };

describe('every checkpoint the running, verifying and paused stages write has a kill point in the union of the lists', () => {
  for (const state of STAGES) {
    it(`${state}: after-checkpoint:<action> for every entry of RUN_NEXT_ACTIONS.${state}`, () => {
      const actions = RUN_NEXT_ACTIONS[state] ?? [];
      assert.ok(actions.length > 0, `${state} has actions`);
      for (const action of actions) assert.ok(UNION.has(`after-checkpoint:${action}`), `${state} action ${action} has no kill point in any list`);
    });
  }

  it('an action outside RUN_KILL_POINTS is named in the list of its own scenario, and every other action is in RUN_KILL_POINTS', () => {
    const inRun = new Set<string>(RUN_KILL_POINTS);
    for (const state of STAGES) {
      for (const action of RUN_NEXT_ACTIONS[state] ?? []) {
        const point = `after-checkpoint:${action}`;
        const own = OTHER_LIST[action];
        if (own === undefined) {
          assert.ok(inRun.has(point), `${point} belongs to RUN_KILL_POINTS: the kill suite reaches it with its single start`);
        } else {
          const list = LISTS.find((l) => l.name === own);
          assert.ok(list?.points.includes(point), `${point} belongs to ${own}`);
          assert.ok(!inRun.has(point), `${point} is not in RUN_KILL_POINTS: the kill suite's reference run never reaches it`);
        }
      }
    }
  });

  it('the transition to each of running and verifying has a kill point, and the counted and mid-action points of the new stages are present', () => {
    for (const state of ['running', 'verifying']) assert.ok(UNION.has(`after-transition:${state}`), `the transition to ${state}`);
    for (const point of ['mid-park', 'after-release:blocked']) assert.ok((PARK_KILL_POINTS as readonly string[]).includes(point), `${point} is in PARK_KILL_POINTS`);
    assert.ok((RESUME_KILL_POINTS as readonly string[]).includes('mid-unpark'), 'mid-unpark is in RESUME_KILL_POINTS');
    assert.ok((CANCEL_KILL_POINTS as readonly string[]).includes('mid-cancel'), 'mid-cancel is in CANCEL_KILL_POINTS');
  });

  it('no list names a point twice, and only the resumed unit\'s mid-invocation:run is shared between two lists', () => {
    for (const list of LISTS) assert.equal(new Set(list.points).size, list.points.length, `${list.name} lists a point twice`);
    const seen = new Map<string, string>();
    const shared: string[] = [];
    for (const list of LISTS) {
      for (const point of list.points) {
        if (seen.has(point)) shared.push(point);
        seen.set(point, list.name);
      }
    }
    assert.deepEqual(shared, ['mid-invocation:run']);
  });
});

describe('every list is exercised by its own suite', () => {
  for (const list of LISTS) {
    it(`${list.name} is imported and run by ${list.suite}`, () => {
      const file = join(REPO_ROOT, list.suite);
      assert.ok(existsSync(file), `${list.suite} exists`);
      const source = readFileSync(file, 'utf8');
      assert.ok(new RegExp(`\\b${list.name}\\b`).test(source), `${list.suite} uses ${list.name}`);
      // The suite either iterates the whole list, or names each of its points where it arms or expects it.
      const iterates = new RegExp(`of\\s+${list.name}\\b`).test(source);
      if (!iterates) {
        for (const point of list.points) assert.ok(source.includes(`'${point}'`), `${list.suite} never names ${point}`);
      }
    });
  }
});

// A checkpoint a stage writes that RUN_NEXT_ACTIONS does not list would escape every rule above, so the literal names the stages commit are read from their sources.
describe('RUN_NEXT_ACTIONS lists every checkpoint a stage commits by name', () => {
  it('reads the literal names of ctx.checkpoint and ctx.transition calls in the run stages, the resume and the cancel', () => {
    const dirs = [join(REPO_ROOT, 'src', 'app', 'run-stages')];
    const files = [...dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.ts')).map((f) => join(d, f))), join(REPO_ROOT, 'src', 'app', 'run-resume.ts'), join(REPO_ROOT, 'src', 'app', 'cancel.ts')];
    const listed = new Set<string>(Object.values(RUN_NEXT_ACTIONS).flat());
    listed.add('none');
    const found = new Set<string>();
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/ctx\.checkpoint\(\s*'([^']+)'/g)) found.add(match[1] as string);
      for (const match of source.matchAll(/ctx\.transition\([^,()]+(?:\([^()]*\))?[^,()]*,\s*'[a-z_]+',\s*'([^']+)'/g)) found.add(match[1] as string);
    }
    assert.ok(found.size >= 12, `the scan found ${found.size} names: ${[...found].join(', ')}`);
    for (const name of found) assert.ok(listed.has(name), `a stage commits the checkpoint ${name}, which RUN_NEXT_ACTIONS does not list`);
  });
});
