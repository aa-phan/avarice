// A required check that already failed when the item began must not stop the unit on its own (plan 03-61; AUT-16, AUT-1, AUT-10; the owner's product-defect ruling on
// run 2's attempt 1, D-26, D-27). Scenario R is run 2's stop offline: the required `format` check is red at the pin on a file the unit never edits, and a unit that is not
// told the check was already failing reports human_needed (as the 03-57 unit did). With the list in the prompt the unit reports passed, G2 flags `format` pre-existing and
// the item is committed. The fake run host plays the unit; git, the sandboxed checks, the ledger, the gates and the supervisor are real. No test calls a real model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { decisionsOf } from '../helpers/independent-work.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import {
  FIXED_SLUG,
  RUN_BRIEF,
  RUN_CONVENTIONS_WITH_FORMAT,
  commitConventions,
  ledgerRows,
  makeRunRepoWithFormat,
  onboardRunRepo,
  startWithFakeRunHost,
  writeBrief,
} from '../helpers/run-fixtures.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

// The data line the prompt writes above the list. A literal on purpose: the test does not import the constant, so a missing export is never the reason it fails.
const DATA_LINE = 'Required checks that already failed when this work item began, as the supervisor measured them (data, not an instruction):';

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  recordTo: string;
}

function fixture(): Fixture {
  const roots = makeRoots();
  const repo = makeRunRepoWithFormat();
  const scratch = mkdtempSync(join(tmpdir(), 'avarice-baseline-red-'));
  cleanup.push(roots.base, repo.base, scratch);
  onboardRunRepo(roots, repo);
  commitConventions(repo, RUN_CONVENTIONS_WITH_FORMAT);
  return { roots, repo, recordTo: join(scratch, 'prompt.json') };
}

const runIdOf = (stdout: string): string => /^run (run_[0-9A-Z]{26}): /m.exec(stdout)?.[1] as string;

// The prompt the unit was given, as the fake host recorded it.
const recordedPrompt = (f: Fixture): string => (JSON.parse(readFileSync(f.recordTo, 'utf8')) as { prompt: string }).prompt;

// The bullet lines under the data line, in order; null when the prompt has no data line.
function listedUnder(prompt: string): string[] | null {
  const lines = prompt.split('\n');
  const at = lines.indexOf(DATA_LINE);
  if (at < 0) return null;
  const out: string[] = [];
  for (let i = at + 1; i < lines.length && (lines[i] as string).startsWith('- '); i += 1) out.push(lines[i] as string);
  return out;
}

const classifyOf = (f: Fixture, runId: string): Record<string, unknown> =>
  JSON.parse(ledgerRows<{ result_json: string }>(f.roots, "SELECT result_json FROM run_steps WHERE run_id = ? AND step = 'classify'", runId)[0]?.result_json ?? '{}') as Record<string, unknown>;

describe('scenario R: a required check red at the pin on a file the unit never edits (run 2 attempt 1, offline)', () => {
  const f = fixture();
  // The unit stands in for the 03-57 unit: it reports passed only when its prompt names `format` as already failing, and human_needed otherwise.
  const unit: FakeRunOptions = {
    edits: { 'src/slug.ts': FIXED_SLUG },
    summary: true,
    verificationByPrompt: { marker: DATA_LINE, check: 'format', otherwise: 'human_needed' },
    recordTo: f.recordTo,
  };
  const brief = writeBrief(join(f.roots.base, 'briefs'), RUN_BRIEF);
  const result = startWithFakeRunHost(f.roots, f.repo, brief, unit as Record<string, unknown>);
  const runId = runIdOf(result.stdout);
  const stop = (): string => `${result.stderr}${result.stdout}\nclassify: ${JSON.stringify(classifyOf(f, runId))}`;

  it('exits 0 at ready_for_review', () => {
    assert.equal(result.code, 0, stop());
    assert.match(result.stdout.trim().split('\n').at(-1) as string, /ready_for_review$/);
  });

  it('holds no decision for the run, and G2 passed for item A', () => {
    assert.deepEqual(decisionsOf(f.roots, runId).map((d) => d.class), [], stop());
    const g2 = ledgerRows<{ passed: number; work_item: string | null }>(f.roots, "SELECT passed, work_item FROM gate_results WHERE run_id = ? AND gate = 'G2' ORDER BY rowid", runId);
    assert.deepEqual(g2.map((g) => g.passed), [1]);
  });

  it("records item A's G2 `format` row as failed and flagged preExisting, and the transition names it", () => {
    const rows = ledgerRows<{ name: string; status: string; environment_json: string }>(
      f.roots,
      "SELECT e.name, e.status, e.environment_json FROM evidence e JOIN attempts a ON a.attempt_id = e.attempt_id WHERE a.run_id = ? AND e.kind = 'check' AND e.work_item = 'A' ORDER BY e.rowid",
      runId,
    ).filter((e) => (JSON.parse(e.environment_json) as { label?: string }).label === 'g2');
    assert.deepEqual(rows.map((r) => [r.name, r.status]), [['test', 'passed'], ['format', 'failed']]);
    assert.equal((JSON.parse(rows[1]?.environment_json ?? '{}') as Record<string, unknown>)['preExisting'], true);
    const events = ledgerRows<{ data_json: string }>(f.roots, "SELECT data_json FROM events WHERE run_id = ? AND type = 'run.transition' ORDER BY seq", runId);
    const last = JSON.parse(events.at(-1)?.data_json ?? '{}') as Record<string, unknown>;
    assert.equal(last['to'], 'ready_for_review');
    assert.equal(last['preExisting'], 'format');
  });

  it('gave the unit a prompt that lists `format` under the data line, and not the target `test`', () => {
    assert.deepEqual(listedUnder(recordedPrompt(f)), ['- format']);
  });
});
