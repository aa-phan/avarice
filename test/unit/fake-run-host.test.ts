// The fake run host's per-item and resume script selection, and what it records for a resumed invocation (plan 03-11; D-08, AUT-3, AUT-5, CON-15).
// The fake plays a `/gsd-quick` unit offline; these tests pin how one host script drives several work items and a resumed session. The
// selection is a pure function of the options, the request and a per-item call index; the record is read from the file the host writes.
// The module is imported as a namespace so a missing export fails one test at a time, not the load of the whole file.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeRunScope } from '../../src/domain/invocation-scope.ts';
import type { InvocationScope } from '../../src/domain/invocation-scope.ts';
import type { InvocationRequest } from '../../src/ports/agent-host.ts';
import { runResumePrompt, runUnitPrompt } from '../../src/app/run-gsd-config.ts';
import type { RunPromptContract } from '../../src/app/run-gsd-config.ts';
import * as fake from '../helpers/fake-run-host.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
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
    assert.deepEqual(out, { edits: { 'src/b.ts': 'resumed\n' } });
    assert.equal(out.question, undefined);
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
