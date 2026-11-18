// The exit tools of the AC-14 brownfield benchmark (plan 04-35; ONB-6, ONB-11, ONB-15; D-03, D-04, D-05). Nothing here starts a model or spends: the tools read the
// owner-approved list, project the spend against the Phase 4 ledger, digest each checkout before and after, and keep the evidence. The cases use temporary
// repositories, a temporary ledger and a temporary home; none reads the owner's repositories, and `authorize` is exercised only through its pure refusal rule.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FULL_MAP_FILES } from '../../src/domain/mapping.ts';
import {
  authorizationProblems,
  authorizeCommand,
  authorizeRefusal,
  buildDryRun,
  captureState,
  entryRefusal,
  judgeEntry,
  loadList,
  profileOf,
  projectionOf,
  readJson,
  sameState,
  updateEvidence,
  verifyEvidence,
  writeEntry,
} from '../../scripts/exit-run-phase4-tools.ts';
import type { AuthorizeIo, DryRunOptions } from '../../scripts/exit-run-phase4-tools.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const REAL_LIST = join(ROOT, 'test', 'benchmark', 'phase4', 'ac14-repositories.json');
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

function git(cwd: string, ...args: string[]): string {
  const ran = spawnSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });
  assert.equal(ran.status, 0, `git ${args.join(' ')}: ${ran.stderr}`);
  return ran.stdout.trim();
}

// A repository with one commit holding `files`; returns its path and the commit.
function makeRepo(dir: string, files: Record<string, string>): { path: string; head: string } {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'one');
  return { path: dir, head: git(dir, 'rev-parse', 'HEAD') };
}

const stampedMap = (): Record<string, string> => Object.fromEntries(FULL_MAP_FILES.map((path) => [path, '---\nlast_mapped_commit: 1234567890abcdef\n---\n# map\n']));

describe('the approved list', () => {
  it('reads the owner-approved list in the repository: five repositories, pinned, approved, hashed', () => {
    const loaded = loadList(REAL_LIST);
    assert.equal(loaded.ok, true, JSON.stringify(loaded));
    if (!loaded.ok) return;
    assert.equal(loaded.list.repositories.length, 5);
    assert.match(loaded.list.sha256, /^[0-9a-f]{64}$/);
    assert.ok(loaded.list.repositories.every((r) => /^[0-9a-f]{40}$/.test(r.pin)));
  });

  it('refuses a draft with no approval and a half-written approval', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p4tools-list-'));
    try {
      const base = JSON.parse(readFileSync(REAL_LIST, 'utf8')) as Record<string, unknown>;
      for (const [name, patch] of [['draft', { approvedBy: null, approvedAt: null }], ['half', { approvedBy: 'Someone', approvedAt: null }], ['badtime', { approvedBy: 'Someone', approvedAt: 'yesterday' }]] as const) {
        const path = join(dir, `${name}.json`);
        writeFileSync(path, JSON.stringify({ ...base, ...patch }));
        const loaded = loadList(path);
        assert.equal(loaded.ok, false, name);
        if (!loaded.ok) assert.match(loaded.problems.join(' '), /approv/i, name);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses an id that would walk out of the clone root, a pin that is not a commit and a duplicate id', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p4tools-list-'));
    try {
      const base = JSON.parse(readFileSync(REAL_LIST, 'utf8')) as { repositories: Array<Record<string, unknown>> };
      const [first] = base.repositories;
      assert.ok(first !== undefined);
      for (const [name, repositories] of [
        ['traversal', [{ ...first, id: '../x' }]],
        ['pin', [{ ...first, pin: 'main' }]],
        ['duplicate', [first, first]],
      ] as const) {
        const path = join(dir, `${name}.json`);
        writeFileSync(path, JSON.stringify({ ...base, repositories }));
        assert.equal(loadList(path).ok, false, name);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the spend projection and the profile choice', () => {
  it('projects the per-repository cap over the repositories against the ceiling and the ledger', () => {
    const fits = projectionOf({ spentUsd: 0.186, ceilingUsd: 40, perRepoCapUsd: 1.6, count: 5 });
    assert.equal(fits.totalUsd, 8);
    assert.equal(fits.fits, true);
    assert.ok(Math.abs(fits.headroomUsd - 39.814) < 1e-9);
    const over = projectionOf({ spentUsd: 35, ceilingUsd: 40, perRepoCapUsd: 1.6, count: 5 });
    assert.equal(over.fits, false);
    assert.equal(projectionOf({ spentUsd: 0, ceilingUsd: 40, perRepoCapUsd: 8, count: 5 }).fits, true);
    assert.equal(projectionOf({ spentUsd: 0, ceilingUsd: 40, perRepoCapUsd: 8.01, count: 5 }).fits, false);
  });

  it('keeps the portfolio in personal-local and puts the other four where the owner chose', () => {
    assert.equal(profileOf('aa-phan-portfolio-v2', 'extended'), 'personal-local');
    assert.equal(profileOf('aa-phan-portfolio-v2', 'local'), 'personal-local');
    assert.equal(profileOf('GroceriesGPT', 'extended'), 'personal-extended');
    assert.equal(profileOf('GroceriesGPT', 'local'), 'personal-local');
  });
});

describe('authorize', () => {
  it('refuses without an interactive terminal on either end', () => {
    assert.match(authorizeRefusal({ stdinTty: false, stdoutTty: true }) ?? '', /interactive terminal/);
    assert.match(authorizeRefusal({ stdinTty: true, stdoutTty: false }) ?? '', /interactive terminal/);
    assert.equal(authorizeRefusal({ stdinTty: true, stdoutTty: true }), undefined);
  });

  const listDigest = 'a'.repeat(64);
  const auth = { ownerConfirmedAt: '2026-11-18T10:00:00Z', terminal: true, listSha256: listDigest, groupCapUsd: 8, perRepoCapUsd: 1.6, perInvocationCapUsd: 0.8, profileChoice: 'extended', host: { claudeBin: '/x/2.1.326', claudeVersion: '2.1.326' } };

  it('accepts an authorization that names the list, the caps and a terminal confirmation', () => {
    assert.deepEqual(authorizationProblems(auth, { listSha256: listDigest, spentUsd: 0.186, ceilingUsd: 40, spentByPlanUsd: 0 }), []);
  });

  it('judges a missing confirmation, another list, a non-terminal record and a cap past the ceiling or the group cap', () => {
    const state = { listSha256: listDigest, spentUsd: 0.186, ceilingUsd: 40, spentByPlanUsd: 0 };
    assert.match(authorizationProblems(undefined, state).join(' '), /no authorization/);
    assert.match(authorizationProblems({ ...auth, ownerConfirmedAt: null }, state).join(' '), /ownerConfirmedAt/);
    assert.match(authorizationProblems({ ...auth, terminal: false }, state).join(' '), /terminal/);
    assert.match(authorizationProblems({ ...auth, listSha256: 'b'.repeat(64) }, state).join(' '), /list/);
    assert.match(authorizationProblems(auth, { ...state, spentUsd: 39.5 }).join(' '), /ceiling/);
    assert.match(authorizationProblems(auth, { ...state, spentByPlanUsd: 7 }).join(' '), /group cap/);
  });
});

describe('the evidence', () => {
  const digests = { head: 'h', filesDigest: 'f', refsDigest: 'r', statusDigest: 's', worktreesDigest: 'w', indexDigest: 'i', gitMetaDigest: 'g', ignoredDigest: 'n' };
  const complete = {
    id: 'a',
    attempt: 1,
    state: 'active',
    containmentFailures: 0,
    before: digests,
    after: { ...digests },
    expectedPath: 'onboard',
  };

  it('refuses an entry that has no before digests or no after digests', () => {
    assert.match(entryRefusal({ ...complete, before: undefined }) ?? '', /before/);
    assert.match(entryRefusal({ ...complete, after: undefined }) ?? '', /after/);
    assert.match(entryRefusal({ ...complete, after: { head: 'h' } }) ?? '', /filesDigest|refsDigest/);
    assert.match(entryRefusal({ ...complete, id: '' }) ?? '', /id/);
    assert.equal(entryRefusal(complete), undefined);
  });

  it('writes a complete entry, replaces the same repository and attempt, and leaves the file alone for a refused one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p4tools-evidence-'));
    try {
      const path = join(dir, 'evidence.json');
      assert.deepEqual(writeEntry(path, complete), { ok: true });
      assert.deepEqual(writeEntry(path, { ...complete, state: 'blocked' }), { ok: true });
      const written = JSON.parse(readFileSync(path, 'utf8')) as { entries: Array<{ state: string }> };
      assert.equal(written.entries.length, 1);
      assert.equal(written.entries[0]?.state, 'blocked');
      const before = readFileSync(path, 'utf8');
      const refused = writeEntry(path, { ...complete, attempt: 2, before: undefined });
      assert.equal(refused.ok, false);
      assert.equal(readFileSync(path, 'utf8'), before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('judges an entry: active, equal digests and no containment failure are the bar', () => {
    assert.deepEqual(judgeEntry(complete), []);
    assert.match(judgeEntry({ ...complete, state: 'blocked' }).join(' '), /active/);
    assert.match(judgeEntry({ ...complete, after: { ...digests, filesDigest: 'changed' } }).join(' '), /filesDigest/);
    assert.match(judgeEntry({ ...complete, containmentFailures: 1 }).join(' '), /containment/);
    assert.match(judgeEntry({ ...complete, containmentFailures: undefined }).join(' '), /containment/);
  });

  const list = { repositories: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id })) };
  const entryFor = (id: string): Record<string, unknown> => ({ ...complete, id });

  it('verifies 5 of 5 active on the approved list and fails on a missing, failed or unapproved repository', () => {
    const all = { entries: list.repositories.map((r) => entryFor(r.id)) };
    const ok = verifyEvidence(all, list);
    assert.equal(ok.ok, true, ok.problems.join('; '));
    assert.equal(ok.active, 5);
    assert.equal(verifyEvidence({ entries: all.entries.slice(0, 4) }, list).ok, false);
    assert.equal(verifyEvidence({ entries: [...all.entries.slice(0, 4), { ...entryFor('e'), state: 'blocked' }] }, list).ok, false);
    assert.match(verifyEvidence({ entries: [...all.entries, entryFor('rekordbox-mcp')] }, list).problems.join(' '), /not on the approved list/);
  });

  it('judges the latest attempt of a repository, so a later pass stands after an earlier stop', () => {
    const all = list.repositories.map((r) => entryFor(r.id));
    const retried = [{ ...entryFor('e'), attempt: 1, state: 'blocked' }, ...all.slice(0, 4), { ...entryFor('e'), attempt: 2 }];
    assert.equal(verifyEvidence({ entries: retried }, list).ok, true);
  });
});

describe('the dry run', () => {
  let dir: string;
  let ledger: string;
  let home: string;
  let optionsFor: (patch?: Partial<DryRunOptions>) => DryRunOptions;
  let owner: Array<{ id: string; path: string; head: string }>;
  const clones: string[] = [];
  const savedLedger = process.env['AVARICE_PHASE4_LEDGER'];
  const savedCeiling = process.env['AVARICE_PHASE4_CEILING_USD'];

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'p4tools-dry-'));
    home = join(dir, 'home');
    mkdirSync(join(home, '.local', 'share', 'claude', 'versions'), { recursive: true });
    writeFileSync(join(home, '.local', 'share', 'claude', 'versions', '2.1.326'), '#!/bin/sh\n');
    ledger = join(dir, 'ledger.jsonl');
    writeFileSync(ledger, `${JSON.stringify({ plan: '04-34', case: 'x', costUsd: 0.186, claudeVersion: '2.1.326', at: '2026-11-18T00:00:00Z' })}\n`);
    process.env['AVARICE_PHASE4_LEDGER'] = ledger;
    delete process.env['AVARICE_PHASE4_CEILING_USD'];
    owner = [
      { id: 'aa-phan-portfolio-v2', ...makeRepo(join(home, 'aa-phan-portfolio-v2'), { 'src/a.ts': 'export const a = 1;\n', '.planning/STATE.md': '# state\n' }) },
      { id: 'gsd', ...makeRepo(join(home, 'gsd'), { 'main.py': 'print(1)\n', ...stampedMap() }) },
      { id: 'plain', ...makeRepo(join(home, 'plain'), { 'index.ts': 'export {};\n' }) },
    ];
    const remotes = [
      { id: 'pub-go', url: 'https://example.invalid/pub-go', ...makeRepo(join(dir, 'remote-go'), { 'main.go': 'package main\n' }) },
      { id: 'pub-rs', url: 'https://example.invalid/pub-rs', ...makeRepo(join(dir, 'remote-rs'), { 'main.rs': 'fn main() {}\n' }) },
    ];
    const repositories = [
      ...owner.map((r) => ({ id: r.id, stack: 'x', source: `~/${r.id}`, sourceKind: 'owner-path', pin: r.head, hasPlanning: false })),
      ...remotes.map((r) => ({ id: r.id, stack: 'x', source: r.url, sourceKind: 'public-url', pin: r.head, hasPlanning: false })),
    ];
    const listPath = join(dir, 'list.json');
    writeFileSync(listPath, JSON.stringify({ schema: 1, approvedBy: 'Tester', approvedAt: '2026-11-16T18:47:56Z', decision: 'D-05', passBar: 'x', repositories }));
    writeFileSync(join(dir, 'draft.json'), JSON.stringify({ schema: 1, approvedBy: null, approvedAt: null, decision: 'D-05', passBar: 'x', repositories }));
    optionsFor = (patch = {}) => ({
      listPath,
      home,
      cloneRoot: join(dir, 'clones'),
      perRepoCapUsd: 1.6,
      expectedCount: 5,
      activeRecordOf: (repoPath) => (repoPath.endsWith('/aa-phan-portfolio-v2') ? { profile: 'personal-local', version: 3, mappingMode: 'full', completeness: 'complete', onboardedRevision: 'abc' } : undefined),
      clone: (url, dest, pin) => {
        clones.push(dest);
        const remote = remotes.find((r) => r.url === url);
        assert.ok(remote !== undefined, `no remote for ${url}`);
        const ran = spawnSync('git', ['clone', '-q', '--no-checkout', remote.path, dest], { env: GIT_ENV, encoding: 'utf8' });
        assert.equal(ran.status, 0, ran.stderr);
        git(dest, '-c', 'advice.detachedHead=false', 'checkout', '-q', '--detach', pin);
      },
      ...patch,
    });
  });

  after(() => {
    if (savedLedger === undefined) delete process.env['AVARICE_PHASE4_LEDGER'];
    else process.env['AVARICE_PHASE4_LEDGER'] = savedLedger;
    if (savedCeiling === undefined) delete process.env['AVARICE_PHASE4_CEILING_USD'];
    else process.env['AVARICE_PHASE4_CEILING_USD'] = savedCeiling;
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists the five repositories with source, pin, expected path, profile, digests and cap, and projects the total', () => {
    const states = owner.map((r) => captureState(r.path));
    const report = buildDryRun(optionsFor());
    assert.deepEqual(report.problems, []);
    assert.equal(report.repositories.length, 5);
    const byId = new Map(report.repositories.map((r) => [r.id, r]));
    assert.equal(byId.get('aa-phan-portfolio-v2')?.expectedPath, 'refresh');
    assert.equal(byId.get('aa-phan-portfolio-v2')?.profile, 'personal-local');
    assert.equal(byId.get('gsd')?.expectedPath, 'onboard');
    assert.equal(byId.get('gsd')?.existingMap?.class, 'stamped-complete');
    assert.equal(byId.get('pub-go')?.sourceKind, 'public-url');
    for (const r of report.repositories) {
      assert.match(r.state.filesDigest, /^[0-9a-f]{64}$/, r.id);
      assert.match(r.state.refsDigest, /^[0-9a-f]{64}$/, r.id);
      assert.equal(r.headIsPin, true, r.id);
      assert.equal(r.capUsd, 1.6);
    }
    assert.equal(report.spend.projectedUsd, 8);
    assert.equal(report.spend.fits, true);
    assert.ok(Math.abs(report.spend.spentUsd - 0.186) < 1e-9);
    // The dry run is read-only: the owner-path repositories are byte-identical after it.
    owner.forEach((r, i) => assert.equal(sameState(states[i] as ReturnType<typeof captureState>, captureState(r.path)), true, r.id));
  });

  it('spends nothing: the ledger is unchanged by a dry run', () => {
    const before = readFileSync(ledger, 'utf8');
    buildDryRun(optionsFor());
    assert.equal(readFileSync(ledger, 'utf8'), before);
  });

  it('clones a public repository once at its pin and leaves an existing clone alone on a second run', () => {
    const first = buildDryRun(optionsFor());
    const cloneOf = (id: string): string => first.repositories.find((r) => r.id === id)?.path ?? '';
    assert.ok(existsSync(join(cloneOf('pub-go'), 'main.go')));
    const stateBefore = captureState(cloneOf('pub-go'));
    const count = clones.length;
    const second = buildDryRun(optionsFor());
    assert.equal(clones.length, count, 'a second dry run clones nothing');
    assert.equal(sameState(stateBefore, captureState(cloneOf('pub-go'))), true);
    assert.deepEqual(second.problems, []);
  });

  it('exits non-zero in effect when the list is unapproved, and clones nothing for it', () => {
    const count = clones.length;
    const report = buildDryRun(optionsFor({ listPath: join(dir, 'draft.json') }));
    assert.ok(report.problems.length > 0);
    assert.match(report.problems.join(' '), /approv/i);
    assert.equal(report.repositories.length, 0);
    assert.equal(clones.length, count);
  });

  it('reports a problem when the projection passes the ceiling', () => {
    process.env['AVARICE_PHASE4_CEILING_USD'] = '5';
    try {
      const report = buildDryRun(optionsFor());
      assert.equal(report.spend.fits, false);
      assert.match(report.problems.join(' '), /ceiling/);
    } finally {
      delete process.env['AVARICE_PHASE4_CEILING_USD'];
    }
  });

  it('reports a problem when fewer than the expected five repositories are listed', () => {
    const report = buildDryRun(optionsFor({ expectedCount: 6 }));
    assert.match(report.problems.join(' '), /expected 6/);
  });

  it('records an authorization only from a terminal, on the typed word, once, with the chosen profile for the four new repositories', async () => {
    // Every path here is a temporary one: the case never reads or writes the real evidence file.
    const evidence = join(dir, 'auth-evidence.json');
    const report = buildDryRun(optionsFor());
    updateEvidence(evidence, () => ({ schema: 1, dryRun: report }));
    const argv = ['--cap', '8', '--profile', 'extended', '--list', join(dir, 'list.json'), '--evidence', evidence];
    const io = (tty: boolean, answer: string): AuthorizeIo => ({ stdinTty: tty, stdoutTty: tty, ask: async () => answer, now: () => new Date('2026-11-18T10:00:00Z'), env: {} });
    assert.equal(await authorizeCommand(argv, io(false, 'authorize')), 2);
    assert.equal(readJson(evidence)?.['authorization'], undefined);
    assert.equal(await authorizeCommand(argv, io(true, 'yes')), 1);
    assert.equal(readJson(evidence)?.['authorization'], undefined);
    assert.equal(await authorizeCommand(['--cap', '8', '--profile', 'extended', '--per-repo', '9', '--list', join(dir, 'list.json'), '--evidence', evidence], io(true, 'authorize')), 2, 'per-repository caps over the group cap');
    assert.equal(await authorizeCommand(argv, io(true, 'authorize')), 0);
    const auth = readJson(evidence)?.['authorization'] as Record<string, unknown>;
    assert.equal(auth['ownerConfirmedAt'], '2026-11-18T10:00:00.000Z');
    assert.equal(auth['terminal'], true);
    assert.equal(auth['perRepoCapUsd'], 1.6);
    assert.equal(auth['perInvocationCapUsd'], 0.8);
    assert.deepEqual(auth['profiles'], { 'aa-phan-portfolio-v2': 'personal-local', gsd: 'personal-extended', plain: 'personal-extended', 'pub-go': 'personal-extended', 'pub-rs': 'personal-extended' });
    assert.equal(await authorizeCommand(argv, io(true, 'authorize')), 2, 'a second authorization needs --replace');
    assert.deepEqual(authorizationProblems(auth, { listSha256: report.list?.sha256 ?? '', spentUsd: 0.186, ceilingUsd: 40, spentByPlanUsd: 0 }), []);
  });

  it('refuses to authorize when no dry run of this list is recorded', async () => {
    const evidence = join(dir, 'no-dry-run.json');
    const io: AuthorizeIo = { stdinTty: true, stdoutTty: true, ask: async () => 'authorize', now: () => new Date(), env: {} };
    assert.equal(await authorizeCommand(['--cap', '8', '--profile', 'local', '--list', join(dir, 'list.json'), '--evidence', evidence], io), 2);
    assert.equal(existsSync(evidence), false);
  });

  it('reports a public clone that is not clean instead of changing it', () => {
    const report = buildDryRun(optionsFor());
    const clone = report.repositories.find((r) => r.id === 'pub-rs')?.path ?? '';
    writeFileSync(join(clone, 'extra.txt'), 'edited by someone\n');
    const again = buildDryRun(optionsFor());
    assert.ok(existsSync(join(clone, 'extra.txt')), 'the dry run never cleans a clone');
    assert.match(again.problems.join(' '), /pub-rs.*not clean/);
    rmSync(join(clone, 'extra.txt'));
    assert.deepEqual(buildDryRun(optionsFor()).problems, []);
  });
});
