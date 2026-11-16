// A run's verifier must have a content-search route (plan 03-69; AUT-1, CON-15; the owner's brief-harness-defect ruling on run 3's attempt 1, D-26, D-27). Scenario S is run 3's
// attempt 1 offline: the verifier must search a file outside the item's write set (`docs/usage.md`). On run 3 the pinned host had removed its Grep tool from the session, the
// tool error told the agent to use `grep` through the shell, and the hook refused every shell grep, so the verifier wrote human_needed and the run stopped on an unplanned
// pause. The fake run host plays the unit and its verifier while git, the sandboxed checks, the hook, the ledger, the gates and the supervisor are real. The fake decides whether
// the session has Grep from the production launch line, by the rule host-search-tools.test.ts measures on the real pinned binary (hostKeepsSearchTools). No test calls a real model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { decisionsOf } from '../helpers/independent-work.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { FIXED_SLUG, RUN_BRIEF, RUN_CONVENTIONS, commitConventions, ledgerRows, makeRunRepo, onboardRunRepo, startWithFakeRunHost, writeBrief } from '../helpers/run-fixtures.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const USAGE = '# Usage\n\nCall slugify(title) to get a slug.\n';

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  brief: string;
  recordTo: string;
}

function fixture(): Fixture {
  const roots = makeRoots();
  // `docs/usage.md` is outside RUN_CONVENTIONS' write set (src/** and test/**): the verifier can only read it.
  const repo = makeRunRepo({ 'docs/usage.md': USAGE });
  const scratch = mkdtempSync(join(tmpdir(), 'avarice-search-route-'));
  cleanup.push(roots.base, repo.base, scratch);
  onboardRunRepo(roots, repo);
  commitConventions(repo, RUN_CONVENTIONS);
  return { roots, repo, brief: writeBrief(join(roots.base, 'briefs'), RUN_BRIEF), recordTo: join(scratch, 'record.json') };
}

const runIdOf = (stdout: string): string => /^run (run_[0-9A-Z]{26}): /m.exec(stdout)?.[1] as string;

interface Recorded {
  search?: { available: boolean; outside: Array<{ path: string; denied: boolean }>; denied: boolean; matched: string[]; shell: { command: string; denied: boolean } | null };
}
const recorded = (f: Fixture): Recorded => JSON.parse(readFileSync(f.recordTo, 'utf8')) as Recorded;

const classifyOf = (f: Fixture, runId: string): Record<string, unknown> =>
  JSON.parse(ledgerRows<{ result_json: string }>(f.roots, "SELECT result_json FROM run_steps WHERE run_id = ? AND step = 'classify'", runId)[0]?.result_json ?? '{}') as Record<string, unknown>;

const hookDecisions = (f: Fixture, runId: string): Array<Record<string, unknown>> =>
  ledgerRows<{ data_json: string }>(f.roots, "SELECT data_json FROM events WHERE run_id = ? AND type = 'hook.decision' ORDER BY seq", runId).map((row) => JSON.parse(row.data_json) as Record<string, unknown>);

const VERIFIER = 'agent-fake-verifier';

describe('scenario S: a verifier that must search a file outside the write set (run 3 attempt 1, offline)', () => {
  const f = fixture();
  // The unit plays the slug edit; its verifier searches `docs` for slugify, after trying the owner's checkout and /etc, and writes human_needed when it cannot search.
  const unit: FakeRunOptions = {
    edits: { 'src/slug.ts': FIXED_SLUG },
    summary: true,
    verifierSearch: { pattern: 'slugify', path: 'docs', expect: ['docs/usage.md'], outside: [f.repo.path, '/etc'], otherwise: 'human_needed' },
    recordTo: f.recordTo,
  };
  const result = startWithFakeRunHost(f.roots, f.repo, f.brief, unit as Record<string, unknown>);
  const runId = runIdOf(result.stdout);
  const stop = (): string => `${result.stderr}${result.stdout}\nclassify: ${JSON.stringify(classifyOf(f, runId))}\nrecord: ${JSON.stringify(recorded(f).search)}`;

  it('exits 0 at ready_for_review', () => {
    assert.equal(result.code, 0, stop());
    assert.match(result.stdout.trim().split('\n').at(-1) as string, /ready_for_review$/, stop());
  });

  it('holds no decision for the run, and G2 passed for item A', () => {
    assert.deepEqual(decisionsOf(f.roots, runId).map((d) => [d.class, d.state]), [], stop());
    const g2 = ledgerRows<{ passed: number }>(f.roots, "SELECT passed FROM gate_results WHERE run_id = ? AND gate = 'G2' ORDER BY rowid", runId);
    assert.deepEqual(g2.map((g) => g.passed), [1], stop());
    assert.notEqual(classifyOf(f, runId)['pauseSignal'], 'verification-human-needed', stop());
  });

  it('shows search available, both outside paths denied and never searched, and the match equal to docs/usage.md', () => {
    const search = recorded(f).search;
    assert.ok(search, stop());
    assert.equal(search.available, true, stop());
    assert.deepEqual(search.outside.map((o) => [o.path, o.denied]), [[f.repo.path, true], ['/etc', true]], stop());
    assert.equal(search.denied, false, stop());
    assert.deepEqual(search.matched, ['docs/usage.md'], stop());
    assert.equal(search.shell, null, stop());
  });

  it('recorded an allow for tool Grep with the verifier agent and a deny for each outside path', () => {
    const greps = hookDecisions(f, runId).filter((d) => d['tool'] === 'Grep' && d['agentId'] === VERIFIER);
    assert.deepEqual(greps.map((d) => d['decision']), ['deny', 'deny', 'allow'], JSON.stringify(greps));
    assert.ok(greps.every((d) => d['decision'] === 'allow' || typeof d['rule'] === 'string'), JSON.stringify(greps));
    const shells = hookDecisions(f, runId).filter((d) => d['tool'] === 'Bash' && d['agentId'] === VERIFIER);
    assert.deepEqual(shells, [], 'the verifier tried no shell');
  });
});
