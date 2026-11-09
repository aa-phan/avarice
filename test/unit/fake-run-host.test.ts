// The fake run host's per-item and resume script selection, and what it records for a resumed invocation (plan 03-11; D-08, AUT-3, AUT-5, CON-15).
// The fake plays a `/gsd-quick` unit offline; these tests pin how one host script drives several work items and a resumed session. The
// selection is a pure function of the options, the request and a per-item call index; the record is read from the file the host writes.
// The module is imported as a namespace so a missing export fails one test at a time, not the load of the whole file.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBrief } from '../../src/domain/brief.ts';
import type { BriefItem } from '../../src/domain/brief.ts';
import { computeRunScope } from '../../src/domain/invocation-scope.ts';
import type { InvocationScope } from '../../src/domain/invocation-scope.ts';
import type { InvocationRequest } from '../../src/ports/agent-host.ts';
import { runResumePrompt, runUnitPrompt } from '../../src/app/run-gsd-config.ts';
import type { RunPromptContract } from '../../src/app/run-gsd-config.ts';
import * as fake from '../helpers/fake-run-host.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import {
  FIXED_SLUG,
  ITEMS_BRIEF,
  RUN_CONVENTIONS_WITH_COMMANDS,
  commitConventions,
  ledgerRows,
  makeRunRepo,
  onboardRunRepo,
  runInProcess,
  writeBrief,
  writeItemsBrief,
} from '../helpers/run-fixtures.ts';
import { makeScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

// The unit prompt and the resume prompt as the production code writes them, so the selection reads the real item line.
const CONTRACT: RunPromptContract = {
  intent: { title: 'Say Work item Z: this is only a title', behavior: 'Do it.', acceptance: [{ id: 'AC1', text: 'It works', verifiedBy: ['check:test'] }], exclusions: [] },
  files: { write: ['src/**'], create: [], artifacts: ['.planning/quick/**'] },
  execution: { commands: ['npm test'] },
  decisions: { human: ['scope expansion'], delegated: ['internal naming'] },
};
const unitPrompt = (id: string): string => runUnitPrompt(CONTRACT, '', { id, task: `task of ${id}`, acceptance: ['AC1: It works'], specFiles: [] });
const resumePrompt = (id: string): string => runResumePrompt('Use the first option', { id, task: `task of ${id}`, acceptance: ['AC1: It works'], specFiles: [] });
const SESSION = '3f2a9c1e-7b4d-4e8a-9c55-0a1b2c3d4e5f';

const select = (base: FakeRunOptions, prompt: string, index = 0, resumeSessionId?: string): FakeRunOptions =>
  fake.selectFakeOptions(base, { prompt, ...(resumeSessionId !== undefined ? { resumeSessionId } : {}) }, index);

describe('selectFakeOptions: one host script, several items (plan 03-11)', () => {
  const BASE: FakeRunOptions = {
    edits: { 'src/slug.ts': 'base\n' },
    perItem: {
      A: { summary: true },
      B: { question: 'Which format?', perAttempt: [{ summary: false }, { summary: true }], resume: { edits: { 'src/b.ts': 'resumed\n' } } },
    },
    resume: { edits: { 'src/other.ts': 'resumed other\n' } },
  };

  it('reads the item from the `Work item <ID>:` line and merges that item over the base', () => {
    assert.deepEqual(select(BASE, unitPrompt('A')), { edits: { 'src/slug.ts': 'base\n' }, summary: true });
  });

  it('applies the item perAttempt entry for the n-th fresh call of that item, on top of the item options', () => {
    assert.deepEqual(select(BASE, unitPrompt('B'), 0), { edits: { 'src/slug.ts': 'base\n' }, question: 'Which format?', summary: false });
    assert.deepEqual(select(BASE, unitPrompt('B'), 1), { edits: { 'src/slug.ts': 'base\n' }, question: 'Which format?', summary: true });
  });

  it('an item with no entry gets the base alone', () => {
    assert.deepEqual(select(BASE, unitPrompt('C')), { edits: { 'src/slug.ts': 'base\n' } });
  });

  it('a resumed call gets the base merged with the item resume entry, and not the item question that paused it', () => {
    const out = select(BASE, resumePrompt('B'), 0, SESSION);
    assert.equal(out.question, undefined);
    assert.deepEqual(out, { edits: { 'src/b.ts': 'resumed\n' } });
  });

  it('a resumed call for an item with no resume entry falls back to the base resume entry', () => {
    assert.deepEqual(select(BASE, resumePrompt('A'), 0, SESSION), { edits: { 'src/other.ts': 'resumed other\n' } });
    assert.deepEqual(select(BASE, resumePrompt('C'), 0, SESSION), { edits: { 'src/other.ts': 'resumed other\n' } });
  });

  it('a resumed call with no resume entry anywhere runs the base options', () => {
    assert.deepEqual(select({ edits: { 'src/slug.ts': 'base\n' } }, resumePrompt('A'), 0, SESSION), { edits: { 'src/slug.ts': 'base\n' } });
  });

  it('a prompt with no item line returns the base merged with perAttempt, as Phase 2 tests expect', () => {
    const base: FakeRunOptions = { edits: { 'src/slug.ts': 'x\n' }, perAttempt: [{ summary: false }, { question: 'Why?' }] };
    const plain = '/gsd-quick --validate --text "Task: fix the slug"';
    assert.deepEqual(select(base, plain, 0), { edits: { 'src/slug.ts': 'x\n' }, summary: false });
    assert.deepEqual(select(base, plain, 1), { edits: { 'src/slug.ts': 'x\n' }, question: 'Why?' });
    assert.deepEqual(select(base, plain, 2), { edits: { 'src/slug.ts': 'x\n' } });
  });

  it('does not take a `Work item` phrase inside the task title or text for the item line', () => {
    const prompt = runUnitPrompt(CONTRACT, '', undefined);
    assert.match(prompt, /Say Work item Z: this is only a title/);
    assert.deepEqual(select({ perItem: { Z: { question: 'wrong' } }, edits: { 'a.ts': '1' } }, prompt), { edits: { 'a.ts': '1' } });
  });

  it('the selected options carry none of the selection keys, and survive JSON as the supervisor receives them', () => {
    const out = select(BASE, unitPrompt('B'), 1);
    for (const key of ['perItem', 'resume', 'perAttempt']) assert.equal(Object.hasOwn(out, key), false, key);
    assert.deepEqual(JSON.parse(JSON.stringify(BASE)), BASE);
  });
});

// A request the fake can run with no ledger: a scratch clone, a scope with nothing to write, and no tool call (no edits, no summary).
function bareRequest(over: Partial<InvocationRequest>): { req: InvocationRequest; recordTo: string; clone: string } {
  const repo = makeScratchRepo({ files: { 'src/a.ts': 'a\n' } });
  const data = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-fake-run-unit-')));
  cleanup.push(repo.base, data);
  const scope: InvocationScope = computeRunScope({
    contract: {
      files: { write: ['src/**'], create: [], artifacts: [], protected: [], secretGlobs: [] },
      execution: { commands: [] },
      budgets: { subagentsTotal: 4, subagentsConcurrent: 2 },
    },
    clonePath: repo.path,
    repoPath: repo.path,
    dataRoot: data,
    home: data,
    workRoot: data,
    scratchDir: join(data, 'scratch'),
    workspace: { topLevelEntries: ['src'], entriesByDir: {}, gitPaths: [], repoReadAllow: [] },
    readRoots: [],
  });
  const req: InvocationRequest = {
    onboardingId: 'onb_none',
    runId: 'run_none',
    invocationId: 'inv_none',
    purpose: 'run',
    contractVersion: 1,
    contractDigest: 'd',
    prompt: 'p',
    cwd: repo.path,
    model: 'sonnet',
    costCapUsd: 1,
    wallClockMs: 60_000,
    scope,
    extensions: { skills: [], agents: [] },
    expectedFiles: [],
    ...over,
  };
  return { req, recordTo: join(data, 'record.json'), clone: repo.path };
}

describe('FakeRunHost records a resumed invocation (D-08)', () => {
  it('writes the prompt, the resumeSessionId and the session the invocation ran under', async () => {
    const { req, recordTo } = bareRequest({ prompt: resumePrompt('B'), resumeSessionId: SESSION, sessionId: '11111111-2222-4333-8444-555555555555' });
    const host = new fake.FakeRunHost({ recordTo, summary: false });
    const out = await host.invoke(req, new AbortController().signal);
    assert.ok(out.ok, JSON.stringify(out));
    const record = JSON.parse(readFileSync(recordTo, 'utf8')) as Record<string, unknown>;
    assert.equal(record['prompt'], req.prompt);
    assert.equal(record['resumeSessionId'], SESSION);
    assert.equal(record['sessionId'], SESSION, 'the resumed session wins over a fresh session ID, as in the real adapter');
    assert.equal(record['invocationId'], 'inv_none');
    assert.equal(out.value.sessionId, SESSION);
  });

  it('a fresh invocation records its own session and no resumeSessionId', async () => {
    const { req, recordTo } = bareRequest({ prompt: unitPrompt('A'), sessionId: '11111111-2222-4333-8444-555555555555' });
    const host = new fake.FakeRunHost({ recordTo, summary: false });
    const out = await host.invoke(req, new AbortController().signal);
    assert.ok(out.ok, JSON.stringify(out));
    const record = JSON.parse(readFileSync(recordTo, 'utf8')) as Record<string, unknown>;
    assert.equal(record['sessionId'], '11111111-2222-4333-8444-555555555555');
    assert.equal(Object.hasOwn(record, 'resumeSessionId'), false);
  });

  it('an item resume entry sets its own recordTo, so one script records each item', async () => {
    const first = bareRequest({ prompt: resumePrompt('B'), resumeSessionId: SESSION });
    const second = bareRequest({ prompt: resumePrompt('C'), resumeSessionId: SESSION });
    const host = new fake.FakeRunHost({ summary: false, perItem: { B: { resume: { recordTo: first.recordTo } }, C: { resume: { recordTo: second.recordTo } } } });
    assert.ok((await host.invoke(first.req, new AbortController().signal)).ok);
    assert.ok((await host.invoke(second.req, new AbortController().signal)).ok);
    assert.match(String((JSON.parse(readFileSync(first.recordTo, 'utf8')) as { prompt: string }).prompt), /Work item B:/);
    assert.match(String((JSON.parse(readFileSync(second.recordTo, 'utf8')) as { prompt: string }).prompt), /Work item C:/);
  });

  it('counts fresh calls per item, so perAttempt of one item is not moved by another', async () => {
    const calls: string[] = [];
    const host = new fake.FakeRunHost({
      summary: false,
      perItem: { A: { perAttempt: [{ question: 'A first?' }, { question: 'A second?' }] }, B: { perAttempt: [{ question: 'B first?' }] } },
    });
    for (const id of ['A', 'B', 'A']) {
      const { req } = bareRequest({ prompt: unitPrompt(id) });
      const out = await host.invoke(req, new AbortController().signal);
      assert.ok(out.ok, JSON.stringify(out));
      calls.push(String(out.value.question));
    }
    assert.deepEqual(calls, ['A first?', 'B first?', 'A second?']);
  });
});

describe('FakeRunHost: a missing session (D-08)', () => {
  it('a resumed call with missingSession ends as the CLI does for an unknown session: exit 1, no result, kind failed, nothing written', async () => {
    const { req, clone } = bareRequest({ prompt: resumePrompt('B'), resumeSessionId: SESSION });
    const host = new fake.FakeRunHost({ edits: { 'src/a.ts': 'changed\n' }, resume: { missingSession: true } });
    const out = await host.invoke(req, new AbortController().signal);
    assert.ok(out.ok, JSON.stringify(out));
    assert.equal(out.value.kind, 'failed');
    assert.equal(out.value.details?.exitCode, 1);
    assert.equal(out.value.details?.resultSeen, false);
    assert.equal(out.value.question, undefined);
    assert.equal(out.value.headBefore, out.value.headAfter);
    assert.equal(readFileSync(join(clone, 'src/a.ts'), 'utf8'), 'a\n', 'the clone is untouched');
  });

  it('only a resumed call is affected: a fresh call of the same host ignores it', async () => {
    const fresh = bareRequest({ prompt: unitPrompt('B') });
    const host = new fake.FakeRunHost({ summary: false, missingSession: true });
    const out = await host.invoke(fresh.req, new AbortController().signal);
    assert.ok(out.ok, JSON.stringify(out));
    assert.equal(out.value.kind, 'progressed');
    assert.equal(out.value.details?.exitCode, 0);
  });
});

describe('the new options are plain data (the supervisor receives them as JSON)', () => {
  it('missingSession, subagents and planText survive JSON through perItem and resume, and are selected like any option', () => {
    const options: FakeRunOptions = {
      subagents: 2,
      planText: '# Plan\n\nFiles: src/slug.ts\n',
      perItem: { B: { question: 'Which?', resume: { missingSession: true, subagents: 1, planText: 'p' } } },
      resume: { missingSession: false },
    };
    assert.deepEqual(JSON.parse(JSON.stringify(options)), options);
    assert.deepEqual(select(options, resumePrompt('B'), 0, SESSION), { subagents: 1, planText: 'p', missingSession: true });
    assert.deepEqual(select(options, unitPrompt('B'), 0), { subagents: 2, planText: '# Plan\n\nFiles: src/slug.ts\n', question: 'Which?' });
  });
});

describe('the items brief fixture', () => {
  it('ITEMS_BRIEF parses to three items: A and B depend on nothing, C on B, each with one criterion verified by check:test', () => {
    const parsed = parseBrief(ITEMS_BRIEF, { kind: 'inline', id: 'items-brief' });
    assert.ok(parsed.ok, JSON.stringify(parsed));
    const brief = parsed.value;
    assert.deepEqual(brief.items?.map((item) => [item.id, item.dependsOn, item.acceptance]), [['A', [], ['AC1']], ['B', [], ['AC2']], ['C', ['B'], ['AC3']]]);
    assert.deepEqual(brief.acceptance.map((criterion) => criterion.verifiedBy), [['check:test'], ['check:test'], ['check:test']]);
    assert.deepEqual(brief.write, ['src/**', 'test/**']);
    assert.deepEqual(brief.targetChecks, ['test']);
  });

  it('writeItemsBrief writes the items across continuation lines, and what it writes parses back to the same items', () => {
    const dir = mkdtempSync(join(tmpdir(), 'avarice-items-brief-'));
    cleanup.push(dir);
    const items: BriefItem[] = [
      { id: 'A', title: 'first', dependsOn: [], size: 'small', acceptance: ['AC1'], spec: { files: ['src/slug.ts'] } },
      { id: 'B', title: 'second', dependsOn: ['A'], model: 'opus', acceptance: ['AC2'] },
    ];
    const path = writeItemsBrief(dir, items, ['one | verifiedBy: check:test', 'two | verifiedBy: test:slug'], { name: 'two.md', title: 'Two', front: ['expectedDecisions: 2'], write: ['src/**'] });
    const text = readFileSync(path, 'utf8');
    assert.match(text, /^items: \[\n {2}\{"id":"A"/m, 'the array continues on lines indented by two spaces');
    const parsed = parseBrief(text, { kind: 'file', id: path });
    assert.ok(parsed.ok, JSON.stringify(parsed));
    assert.deepEqual(parsed.value.items, items);
    assert.equal(parsed.value.title, 'Two');
    assert.equal(parsed.value.expectedDecisions, 2);
    assert.deepEqual(parsed.value.write, ['src/**']);
  });
});

// subagents and planText go through the real hook, so they need a ledger: one real run in this process.
describe('subagents and planText through the real hook (G1, CON-15)', () => {
  it('each Agent call is charged to subagentsTotal by the hook, and the run goes on to review', async () => {
    const roots = makeRoots();
    const repo = makeRunRepo();
    cleanup.push(roots.base, repo.base);
    onboardRunRepo(roots, repo);
    commitConventions(repo, RUN_CONVENTIONS_WITH_COMMANDS);
    const brief = writeBrief(join(roots.base, 'briefs'));
    const plan = '# Plan\n\nFiles: src/slug.ts\n';
    const run = await runInProcess(roots, repo, brief, { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed', subagents: 2, planText: plan });
    assert.equal(run.state, 'ready_for_review', String(run.reason));
    const charged = ledgerRows<{ used: number }>(roots, "SELECT used FROM budgets WHERE run_id = ? AND name = 'subagentsTotal'", run.runId);
    assert.equal(charged[0]?.used, 2, 'two Agent calls were charged to subagentsTotal');
    // The stage archives the unit's quick records as artifacts (D-17): the plan the unit was told to leave is among them, byte for byte.
    const records = ledgerRows<{ digest: string }>(roots, "SELECT digest FROM artifacts WHERE run_id = ? AND kind = 'gsd-quick-record'", run.runId).map((row) => row.digest);
    assert.ok(records.includes(`sha256:${createHash('sha256').update(plan).digest('hex')}`), `the quick PLAN.md of the unit was archived, got ${records.join(', ')}`);
  });
});
