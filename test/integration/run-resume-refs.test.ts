// Reference freshness on resume (plan 04-20; FR-8, FR-3, FR-18, S-5, T-04-54). A run records the brief file it was started from in task_refs; `avarice resume`
// refreshes every recorded reference before anything continues, and a changed, deleted or revoked one stops the run on a decision with its own blocked reason
// instead of planning on text that is no longer what the run was built from. Every kill is a real SIGKILL of the detached supervisor; the fake run host plays
// the units; git, the ledger and the lease are real. No test calls a model.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GsdGraphContext } from '../../src/adapters/context/gsd-graph.ts';
import { GsdIntelContext } from '../../src/adapters/context/gsd-intel.ts';
import type { ContextRefreshQuery, ExternalRef } from '../../src/ports/context-source.ts';
import type { GsdOnboarding } from '../../src/ports/gsd-onboarding.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { RUN_EXPIRY_WAIT_MS, resumeRunCli, rows, runRunWithFault, runStatusJson, sleepSync, statusCli } from '../helpers/fault-run.ts';
import { FIXED_SLUG, RUN_CONVENTIONS, commitConventions, commitFiles, makeRunRepo, onboardRunRepo, onboardRunRepoWithIndexes, writeBrief } from '../helpers/run-fixtures.ts';
import { makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const FIX: FakeRunOptions = { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' };

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  brief: string;
}

function fixture(): Fixture {
  const roots = makeRoots();
  const repo = makeRunRepo();
  cleanup.push(roots.base, repo.base);
  onboardRunRepo(roots, repo);
  commitConventions(repo, RUN_CONVENTIONS);
  return { roots, repo, brief: writeBrief(join(roots.base, 'briefs')) };
}

interface TaskRefDb {
  provider: string;
  kind: string;
  ext_id: string;
  revision: string | null;
  retrieved_at: string;
  scope: string;
  freshness: string;
}
const taskRefsOf = (roots: CliRoots, runId: string): TaskRefDb[] =>
  rows<TaskRefDb>(roots, 'SELECT provider, kind, ext_id, revision, retrieved_at, scope, freshness FROM task_refs WHERE run_id = ? ORDER BY provider, kind, ext_id', runId);
const runOf = (roots: CliRoots, runId: string): { state: string; reason: string | null } => rows<{ state: string; reason: string | null }>(roots, 'SELECT state, reason FROM runs WHERE run_id = ?', runId)[0] as { state: string; reason: string | null };
const launches = (roots: CliRoots, runId: string): number => rows<{ n: number }>(roots, "SELECT count(*) AS n FROM run_steps WHERE run_id = ? AND step LIKE 'launch:%'", runId)[0]?.n ?? 0;
const attempts = (roots: CliRoots, runId: string): number => rows<{ n: number }>(roots, 'SELECT count(*) AS n FROM attempts WHERE run_id = ?', runId)[0]?.n ?? 0;

interface DecisionDb {
  decision_id: string;
  class: string;
  issue: string;
  state: string;
  evidence_refs_json: string;
  options_json: string;
}
const decisionsOf = (roots: CliRoots, runId: string): DecisionDb[] =>
  rows<DecisionDb>(roots, 'SELECT decision_id, class, issue, state, evidence_refs_json, options_json FROM decisions WHERE run_id = ? ORDER BY rowid', runId);

const sha256 = (bytes: Buffer): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

describe('S-5 tracer: an edited brief file blocks the resumed run with ref_changed before any unit is launched (FR-8, FR-18, T-04-54)', () => {
  const f = fixture();
  const killed = runRunWithFault(f.roots, f.repo, f.brief, 'after-checkpoint:context-pack#2', FIX);
  const { runId } = killed;
  const briefPath = realpathSync(f.brief);
  const originalDigest = sha256(readFileSync(f.brief));

  it('start records the brief file as a task reference: provider manual-brief, kind brief-file, the real path, the digest of its bytes, fresh', () => {
    const refs = taskRefsOf(f.roots, runId);
    assert.equal(refs.length, 1);
    const ref = refs[0] as TaskRefDb;
    assert.equal(ref.provider, 'manual-brief');
    assert.equal(ref.kind, 'brief-file');
    assert.equal(ref.ext_id, briefPath);
    assert.equal(ref.revision, originalDigest);
    assert.equal(ref.freshness, 'fresh');
    assert.ok(!Number.isNaN(Date.parse(ref.retrieved_at)));
    assert.equal(ref.scope, briefPath);
  });

  it('after the brief is edited, resume blocks the run: blocked_on_decision with reason ref_changed, one open decision naming the brief, no unit launched', () => {
    sleepSync(RUN_EXPIRY_WAIT_MS);
    const launchesBefore = launches(f.roots, runId);
    const attemptsBefore = attempts(f.roots, runId);
    appendFileSync(f.brief, '\nA later line the run was not built from.\n');
    const resumed = resumeRunCli(f.roots, runId, FIX);
    assert.notEqual(resumed.code, 0, `the run waits for the owner: ${resumed.stdout}${resumed.stderr}`);
    assert.deepEqual(runOf(f.roots, runId), { state: 'blocked_on_decision', reason: 'ref_changed' });
    const decisions = decisionsOf(f.roots, runId);
    assert.equal(decisions.length, 1);
    const decision = decisions[0] as DecisionDb;
    assert.equal(decision.state, 'open');
    assert.ok(decision.issue.includes('manual-brief'), decision.issue);
    assert.ok(decision.evidence_refs_json.includes(briefPath), decision.evidence_refs_json);
    assert.equal(launches(f.roots, runId), launchesBefore, 'no host was launched');
    assert.equal(attempts(f.roots, runId), attemptsBefore, 'no attempt was started');
  });

  it('the reference is now `changed` and still names the digest the run was built from', () => {
    const ref = taskRefsOf(f.roots, runId)[0] as TaskRefDb;
    assert.equal(ref.freshness, 'changed');
    assert.equal(ref.revision, originalDigest, 'the revision the pack was built from is kept, so a later resume finds the change again');
  });
});

describe('a deleted brief file blocks the resumed run with ref_deleted (FR-8)', () => {
  const f = fixture();
  const { runId } = runRunWithFault(f.roots, f.repo, f.brief, 'after-checkpoint:context-pack#2', FIX);

  it('resume moves the run to blocked_on_decision with reason ref_deleted and marks the reference deleted', () => {
    sleepSync(RUN_EXPIRY_WAIT_MS);
    rmSync(f.brief);
    const resumed = resumeRunCli(f.roots, runId, FIX);
    assert.notEqual(resumed.code, 0, `${resumed.stdout}${resumed.stderr}`);
    assert.deepEqual(runOf(f.roots, runId), { state: 'blocked_on_decision', reason: 'ref_deleted' });
    assert.equal((taskRefsOf(f.roots, runId)[0] as TaskRefDb).freshness, 'deleted');
    assert.equal(decisionsOf(f.roots, runId).length, 1);
  });
});

describe('an unchanged brief file does not stop the resume (FR-8)', () => {
  const f = fixture();
  const { runId } = runRunWithFault(f.roots, f.repo, f.brief, 'mid-verify', FIX);

  it('the reference is refreshed to fresh and the run goes on to ready_for_review', () => {
    sleepSync(RUN_EXPIRY_WAIT_MS);
    const resumed = resumeRunCli(f.roots, runId, FIX);
    assert.equal(resumed.code, 0, `${resumed.stdout}${resumed.stderr}`);
    assert.equal(runOf(f.roots, runId).state, 'ready_for_review');
    assert.equal((taskRefsOf(f.roots, runId)[0] as TaskRefDb).freshness, 'fresh');
    assert.equal(decisionsOf(f.roots, runId).length, 0);
  });
});

// ---- the context sources refresh a reference against the index and the repository (Task 2; FR-8) -----------------------------------------------

const SOURCE_FILES = { 'src/index.ts': 'export const a = 1;\n', 'README.md': '# scratch\n' };
const NOW = (): number => Date.parse('2026-11-17T10:00:00.000Z');

function refOf(over: Pick<ExternalRef, 'provider' | 'kind' | 'id' | 'scope'>, revision: string): ExternalRef {
  return { ...over, revision, retrievedAt: '2026-11-16T10:00:00.000Z', freshness: 'fresh' };
}
const queryFor = (repo: ScratchRepo, indexRevision: string): ContextRefreshQuery => ({ workspace: { stagingPath: repo.path, repoPath: repo.path }, indexRevision });

// The graph adapter's refresh reads the repository only; the intel adapter also asks GSD whether the intel files moved since its snapshot.
const gsdWithDiff = (diff: { noBaseline?: boolean; changed?: string[] } = {}): GsdOnboarding =>
  ({ intelDiff: async () => ({ ok: true, value: { disabled: false, noBaseline: diff.noBaseline ?? false, changed: diff.changed ?? [], added: [], removed: [] } }) }) as unknown as GsdOnboarding;

function scratch(commits: ReadonlyArray<Record<string, string>> = []): ScratchRepo {
  const repo = makeScratchRepo({ files: SOURCE_FILES, commits });
  cleanup.push(repo.base);
  return repo;
}

describe('gsd-graph refresh judges a node by the index revision and the repository HEAD (FR-8)', () => {
  const graph = new GsdGraphContext({} as GsdOnboarding, { nowMs: NOW });
  const node = (repo: ScratchRepo): ExternalRef => refOf({ provider: 'gsd-graph', kind: 'graph-node', id: 'g1', scope: 'src/index.ts' }, repo.head);

  it('is fresh when the index revision is the recorded one and the repository is still at it', async () => {
    const repo = scratch();
    const refreshed = await graph.refresh(node(repo), queryFor(repo, repo.head));
    assert.ok(refreshed.ok);
    assert.equal(refreshed.value.freshness, 'fresh');
    assert.equal(refreshed.value.revision, repo.head);
    assert.equal(refreshed.value.retrievedAt, '2026-11-17T10:00:00.000Z');
  });

  it('is stale after a new commit that leaves the cited path in place', async () => {
    const repo = scratch();
    const ref = node(repo);
    commitFiles(repo, { 'docs/more.md': 'more\n' }, 'a later commit');
    const refreshed = await graph.refresh(ref, queryFor(repo, ref.revision as string));
    assert.ok(refreshed.ok);
    assert.equal(refreshed.value.freshness, 'stale');
  });

  it('is deleted when the path the node cites no longer exists at HEAD', async () => {
    const repo = scratch();
    const ref = node(repo);
    rmSync(join(repo.path, 'src/index.ts'));
    commitFiles(repo, { 'docs/more.md': 'more\n' }, 'removes src/index.ts');
    const refreshed = await graph.refresh(ref, queryFor(repo, ref.revision as string));
    assert.ok(refreshed.ok);
    assert.equal(refreshed.value.freshness, 'deleted');
  });

  it('is changed when the project record names another build of the graph than the one the reference was recorded at', async () => {
    const repo = scratch([{ 'docs/more.md': 'more\n' }]);
    const refreshed = await graph.refresh(node({ ...repo, head: repo.shas[0] as string }), queryFor(repo, repo.shas[1] as string));
    assert.ok(refreshed.ok);
    assert.equal(refreshed.value.freshness, 'changed');
  });

  it('a node that cites no path is judged by the index alone: stale after a commit, never deleted', async () => {
    const repo = scratch();
    const ref = refOf({ provider: 'gsd-graph', kind: 'graph-node', id: 'g2', scope: '.planning/graphs/graph.json' }, repo.head);
    commitFiles(repo, { 'docs/more.md': 'more\n' }, 'a later commit');
    const refreshed = await graph.refresh(ref, queryFor(repo, repo.head));
    assert.ok(refreshed.ok);
    assert.equal(refreshed.value.freshness, 'stale');
  });
});

describe('gsd-intel refresh mirrors it from the commit the intel was refreshed at (FR-8)', () => {
  const entry = (repo: ScratchRepo, head: string = repo.head): ExternalRef => refOf({ provider: 'gsd-intel', kind: 'intel-entry', id: 'file-roles.json#src/index.ts', scope: '.planning/intel/file-roles.json' }, head);

  it('is fresh at the recorded commit while no intel file moved since GSD snapshotted them', async () => {
    const repo = scratch();
    const refreshed = await new GsdIntelContext(gsdWithDiff(), { nowMs: NOW }).refresh(entry(repo), queryFor(repo, repo.head));
    assert.ok(refreshed.ok);
    assert.equal(refreshed.value.freshness, 'fresh');
  });

  it('is changed while the commits agree but an intel file moved since the snapshot', async () => {
    const repo = scratch();
    const refreshed = await new GsdIntelContext(gsdWithDiff({ changed: ['file-roles.json'] }), { nowMs: NOW }).refresh(entry(repo), queryFor(repo, repo.head));
    assert.ok(refreshed.ok);
    assert.equal(refreshed.value.freshness, 'changed');
  });

  it('is stale after a new commit that leaves the file in place, and deleted once the file the entry describes is gone at HEAD', async () => {
    const repo = scratch();
    const intel = new GsdIntelContext(gsdWithDiff(), { nowMs: NOW });
    const ref = entry(repo);
    commitFiles(repo, { 'docs/more.md': 'more\n' }, 'a later commit');
    const stale = await intel.refresh(ref, queryFor(repo, ref.revision as string));
    assert.ok(stale.ok);
    assert.equal(stale.value.freshness, 'stale');
    rmSync(join(repo.path, 'src/index.ts'));
    commitFiles(repo, { 'docs/other.md': 'other\n' }, 'removes src/index.ts');
    const deleted = await intel.refresh(ref, queryFor(repo, ref.revision as string));
    assert.ok(deleted.ok);
    assert.equal(deleted.value.freshness, 'deleted');
  });

  it('is changed when the intel was refreshed at another commit than the reference was recorded at', async () => {
    const repo = scratch([{ 'docs/more.md': 'more\n' }]);
    const refreshed = await new GsdIntelContext(gsdWithDiff(), { nowMs: NOW }).refresh(entry(repo, repo.shas[0] as string), queryFor(repo, repo.shas[1] as string));
    assert.ok(refreshed.ok);
    assert.equal(refreshed.value.freshness, 'changed');
  });
});

// ---- a run records one reference per pack item, and a resume after a new commit shows them stale -----------------------------------------------

const TERM = 'answer';
const INDEX_BRIEF = ['---', `title: ${TERM}`, '---', '## Behavior', 'A slug never contains two dashes in a row.', '', '## Acceptance criteria', '- AC1: Repeated separators collapse to one dash | verifiedBy: check:test', '', '## Write', '- src/**', '- test/**', '', '## Target checks', '- test', ''].join('\n');
// A graph node ID that holds the two characters a naive key would split on.
const COLON_HASH_ID = 'src/slug.ts:slugify#1';

describe('a run records one task reference per context pack item, with the provider ID unchanged (FR-3, FR-18)', () => {
  let f: Fixture;
  let runId = '';
  before(async () => {
    const roots = makeRoots();
    const repo = makeRunRepo();
    cleanup.push(roots.base, repo.base);
    const { staging } = await onboardRunRepoWithIndexes(roots, repo, TERM);
    const graphPath = join(staging, '.planning', 'graphs', 'graph.json');
    const graph = JSON.parse(readFileSync(graphPath, 'utf8')) as { nodes: Array<{ id: string }>; links: Array<{ source: string; target: string }> };
    const old = (graph.nodes[0] as { id: string }).id;
    (graph.nodes[0] as { id: string }).id = COLON_HASH_ID;
    for (const link of graph.links) {
      if (link.source === old) link.source = COLON_HASH_ID;
      if (link.target === old) link.target = COLON_HASH_ID;
    }
    writeFileSync(graphPath, JSON.stringify(graph));
    commitConventions(repo, { ...RUN_CONVENTIONS, agentCommands: ['npm test'] });
    f = { roots, repo, brief: writeBrief(join(roots.base, 'briefs'), INDEX_BRIEF) };
    runId = runRunWithFault(f.roots, f.repo, f.brief, 'mid-verify', FIX).runId;
  });

  it('every item of the pack step is a row of task_refs with the same provider, ID, scope and revision', () => {
    const step = rows<{ result_json: string }>(f.roots, "SELECT result_json FROM run_steps WHERE run_id = ? AND step = 'context:pack'", runId);
    assert.equal(step.length, 1);
    const pack = JSON.parse(step[0]?.result_json as string) as { items: Array<{ source: string; id: string; scope: string; revision: string | null }> };
    assert.ok(pack.items.length >= 2, `both indexes answered: ${JSON.stringify(pack.items)}`);
    const recorded = taskRefsOf(f.roots, runId).filter((r) => r.provider !== 'manual-brief');
    assert.equal(recorded.length, pack.items.length, 'one row per pack item');
    for (const item of pack.items) {
      const row = recorded.find((r) => r.provider === item.source && r.ext_id === item.id);
      assert.ok(row !== undefined, `${item.source} ${item.id} is recorded`);
      assert.equal(row.scope, item.scope);
      assert.equal(row.revision, item.revision);
      assert.equal(row.kind, item.source === 'gsd-intel' ? 'intel-entry' : 'graph-node');
    }
  });

  it('a provider ID with `#` and `:` round-trips unchanged', () => {
    const ids = taskRefsOf(f.roots, runId).map((r) => r.ext_id);
    assert.ok(ids.includes(COLON_HASH_ID), ids.join(' | '));
  });

  it('after a new commit a resume refreshes the index references to stale, goes on to ready_for_review, and status lists them as stale', () => {
    sleepSync(RUN_EXPIRY_WAIT_MS);
    commitFiles(f.repo, { 'docs/after.md': 'a commit after the pack was built\n' }, 'a later commit');
    const resumed = resumeRunCli(f.roots, runId, FIX);
    assert.equal(resumed.code, 0, `${resumed.stdout}${resumed.stderr}`);
    assert.equal(runOf(f.roots, runId).state, 'ready_for_review');
    const refs = taskRefsOf(f.roots, runId);
    assert.equal(refs.find((r) => r.provider === 'manual-brief')?.freshness, 'fresh');
    const indexRefs = refs.filter((r) => r.provider !== 'manual-brief');
    assert.ok(indexRefs.length >= 2);
    assert.ok(
      indexRefs.every((r) => r.freshness === 'stale'),
      indexRefs.map((r) => `${r.provider}:${r.freshness}`).join(' '),
    );
    const status = runStatusJson(f.roots, runId) as unknown as { staleReferences?: Array<{ provider: string; id: string; freshness: string }> };
    assert.deepEqual(
      status.staleReferences?.map((r) => [r.provider, r.id, r.freshness]),
      indexRefs.map((r) => [r.provider, r.ext_id, 'stale']),
    );
    assert.match(statusCli(f.roots).stdout, /stale references: .*gsd-graph/);
  });
});
