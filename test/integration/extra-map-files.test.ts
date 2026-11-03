// Plan 01-16 gap fix (deferred item 4): validation and activation judge the files the mapping plan requires (four
// for fast, seven for full). A mapper may also write another file under .planning/codebase (the live haiku run
// wrote an unstamped placeholder CONVENTIONS.md in a fast map). That file is recorded as a finding by name only,
// is not stored as a map artifact or listed in the snapshot manifest, and does not fail activation. A required file
// that is missing or unstamped still fails validation.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { REPO_ROOT, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';
import type { FakeHostOptions } from '../helpers/fake-agent-host.ts';
import { readMapDocuments } from '../../src/app/stages/shared.ts';
import { locateGsdCore } from '../../src/adapters/gsd/locate.ts';
import { writeStampFailingGsdCore } from '../helpers/fake-gsd-core.ts';
import { ok } from '../../src/domain/result.ts';
import type { StagingWorkspace } from '../../src/ports/staging-workspace.ts';

const TEST_CLI = join(REPO_ROOT, 'test', 'helpers', 'test-cli.ts');
const REPO_FILES = { 'README.md': '# scratch\n', 'package.json': '{"name":"scratch"}\n', 'src/index.ts': 'export const answer = 42;\n' };
const FAST_FILES = ['STACK.md', 'INTEGRATIONS.md', 'ARCHITECTURE.md', 'STRUCTURE.md'];
const FULL_FILES = ['STACK.md', 'ARCHITECTURE.md', 'STRUCTURE.md', 'CONVENTIONS.md', 'TESTING.md', 'INTEGRATIONS.md', 'CONCERNS.md'];
const dirPath = (name: string): string => `.planning/codebase/${name}`;
const MARKER = 'EXTRA-FILE-CONTENT-MARKER-7731';
const PLACEHOLDER = `# Coding Conventions\n\n${MARKER}: not part of this run's requested focus.\n`;

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function fixture(): { roots: CliRoots; repo: ScratchRepo } {
  const roots = makeRoots();
  const repo = makeScratchRepo({ files: REPO_FILES });
  cleanup.push(roots.base, repo.base);
  return { roots, repo };
}

function onboard(roots: CliRoots, repo: ScratchRepo, host: FakeHostOptions, extra: readonly string[] = [], env: Record<string, string> = {}) {
  return runCli(['onboard', '--policy', 'onboarding', ...extra, repo.path], { roots, entry: TEST_CLI, env: { AVARICE_FAKE_HOST: JSON.stringify(host), ...env } });
}

// GSD_HOME at a gsd-core that runs every verb for real except `stamp-codebase-map`, which fails.
function failingStampEnv(): Record<string, string> {
  const located = locateGsdCore({ HOME: process.env['HOME'] ?? homedir() });
  assert.ok(located.ok, 'the installed gsd-core is admitted');
  const dir = mkdtempSync(join(tmpdir(), 'avarice-failstamp-'));
  cleanup.push(dir);
  return { GSD_HOME: writeStampFailingGsdCore(join(dir, 'gsd-core'), join(located.value.gsdCoreDir, 'bin', 'gsd-tools.cjs')) };
}

function rows<T>(roots: CliRoots, sql: string): T[] {
  const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
  try {
    return (db.prepare(sql).all() as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    db.close();
  }
}

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...filesUnder(full));
    else found.push(full);
  }
  return found;
}

interface RecordBody {
  artifacts: { codebase: Array<{ path: string; digest: string }>; snapshot: string };
  findings: Array<{ source: string; field: string; reason: string; detail?: string }>;
  mapping: { mode: string; completeness: string; scope: string[] };
}

function activeRecord(roots: CliRoots): RecordBody {
  const [row] = rows<{ body_json: string }>(roots, 'SELECT body_json FROM project_records');
  assert.ok(row, 'a project record exists');
  return JSON.parse(row.body_json) as RecordBody;
}

const state = (roots: CliRoots): string | undefined => rows<{ state: string }>(roots, 'SELECT state FROM onboardings')[0]?.state;

function validateChecks(roots: CliRoots): Array<{ name: string; passed: boolean; detail: string }> {
  const [step] = rows<{ result_json: string }>(roots, "SELECT result_json FROM onboarding_steps WHERE step = 'validate' ORDER BY attempt");
  return (JSON.parse(step?.result_json ?? '{"checks":[]}') as { checks: Array<{ name: string; passed: boolean; detail: string }> }).checks;
}

describe('an extra file under .planning/codebase (deferred item 4)', () => {
  it('a fast map with an unstamped extra file reaches active; only the four required files are stored and listed', () => {
    const { roots, repo } = fixture();
    const r = onboard(roots, repo, { files: FAST_FILES, stamp: false, extraWrites: { [dirPath('CONVENTIONS.md')]: PLACEHOLDER } }, ['--mode', 'fast']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(state(roots), 'active');

    const record = activeRecord(roots);
    assert.deepEqual(record.artifacts.codebase.map((c) => c.path).sort(), FAST_FILES.map(dirPath).sort());
    assert.deepEqual(record.mapping.scope, FAST_FILES.map(dirPath));
    assert.equal(record.mapping.completeness, 'partial');
    assert.equal(rows(roots, "SELECT 1 FROM artifacts WHERE kind = 'map-document'").length, 4);
    const [validated] = rows<{ result_json: string }>(roots, "SELECT result_json FROM onboarding_steps WHERE step = 'validate'");
    assert.deepEqual((JSON.parse(validated?.result_json ?? '{}') as { extraFiles: string[]; files: number }).extraFiles, [dirPath('CONVENTIONS.md')]);
    assert.equal((JSON.parse(validated?.result_json ?? '{}') as { files: number }).files, 4);

    const [snapshot] = rows<{ digest: string }>(roots, "SELECT digest FROM artifacts WHERE kind = 'map-snapshot'");
    assert.equal(snapshot?.digest, record.artifacts.snapshot);
    const hex = (snapshot?.digest as string).replace(/^sha256:/, '');
    const manifest = JSON.parse(readFileSync(join(roots.AVARICE_DATA_ROOT, 'artifacts', hex.slice(0, 2), hex), 'utf8')) as { files: Array<{ path: string }> };
    assert.deepEqual(manifest.files.map((f) => f.path).sort(), FAST_FILES.map(dirPath).sort());
  });

  it('records the extra file as a finding by name only; its content is stored nowhere', () => {
    const { roots, repo } = fixture();
    assert.equal(onboard(roots, repo, { files: FAST_FILES, stamp: false, extraWrites: { [dirPath('CONVENTIONS.md')]: PLACEHOLDER } }, ['--mode', 'fast']).code, 0);
    const finding = activeRecord(roots).findings.find((f) => f.field === dirPath('CONVENTIONS.md'));
    assert.ok(finding, 'the extra file is a finding');
    assert.equal(finding.source, 'validation');
    assert.match(finding.reason, /not a map artifact|not stored/);
    assert.equal(finding.detail, undefined);

    const body = JSON.stringify(rows(roots, 'SELECT body_json FROM project_records')) + JSON.stringify(rows(roots, 'SELECT data_json FROM events')) + JSON.stringify(rows(roots, 'SELECT result_json FROM onboarding_steps'));
    assert.equal(body.includes(MARKER), false, 'the extra file content reached the ledger');
    for (const file of filesUnder(join(roots.AVARICE_DATA_ROOT, 'artifacts'))) assert.equal(readFileSync(file, 'utf8').includes(MARKER), false, `the extra file content reached ${file}`);
  });

  it('a full map with an unstamped extra file (not one of the seven) reaches active with the seven files only', () => {
    const { roots, repo } = fixture();
    const r = onboard(roots, repo, { files: FULL_FILES, extraWrites: { [dirPath('NOTES.md')]: `# Notes\n\n${MARKER}\n` } });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const record = activeRecord(roots);
    assert.deepEqual(record.artifacts.codebase.map((c) => c.path).sort(), FULL_FILES.map(dirPath).sort());
    assert.ok(record.findings.some((f) => f.field === dirPath('NOTES.md')));
    assert.equal(rows(roots, "SELECT 1 FROM artifacts WHERE kind = 'map-document'").length, 7);
  });

  it('a clean run records no extra-file finding', () => {
    const { roots, repo } = fixture();
    assert.equal(onboard(roots, repo, { files: FAST_FILES, stamp: false }, ['--mode', 'fast']).code, 0);
    assert.deepEqual(activeRecord(roots).findings.filter((f) => f.reason.includes('not a map artifact')), []);
  });
});

describe('required files are still enforced', () => {
  it('a missing required file fails validation (presence), extra file or not', () => {
    const { roots, repo } = fixture();
    const r = onboard(roots, repo, { files: FAST_FILES, omit: ['STRUCTURE.md'], stamp: false, extraWrites: { [dirPath('CONVENTIONS.md')]: PLACEHOLDER } }, ['--mode', 'fast']);
    assert.equal(r.code, 3, r.stdout + r.stderr);
    assert.equal(state(roots), 'blocked');
    assert.deepEqual(validateChecks(roots).filter((c) => !c.passed).map((c) => c.name), ['presence']);
    assert.equal(rows(roots, 'SELECT 1 FROM project_records').length, 0);
  });

  // Since deferred item 9 AVARICE stamps a full map itself, so a mapper that leaves a file unstamped (the live full map left
  // all seven) no longer fails. Validation still judges the stamp when AVARICE's own stamp could not be applied.
  it('an unstamped required file in a full map is stamped by AVARICE and validates', () => {
    const { roots, repo } = fixture();
    const unstamped = '# Testing\n\nno frontmatter stamp\n';
    const r = onboard(roots, repo, { files: FULL_FILES, rawFiles: { 'TESTING.md': unstamped } });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(validateChecks(roots).find((c) => c.name === 'stamp')?.passed, true);
  });

  it('an unstamped required file fails validation (stamp) in a full map when the stamp AVARICE runs fails', () => {
    const { roots, repo } = fixture();
    const unstamped = '# Testing\n\nno frontmatter stamp\n';
    const r = onboard(roots, repo, { files: FULL_FILES, rawFiles: { 'TESTING.md': unstamped } }, [], failingStampEnv());
    assert.equal(r.code, 3, r.stdout + r.stderr);
    assert.equal(state(roots), 'blocked');
    const failed = validateChecks(roots).filter((c) => !c.passed);
    assert.deepEqual(failed.map((c) => c.name), ['stamp']);
    assert.match(failed[0]?.detail ?? '', /TESTING\.md/);
    assert.ok(rows<{ status: string }>(roots, "SELECT status FROM onboarding_steps WHERE step = 'gsd:stamp'").every((row) => row.status === 'failed'), 'the failed stamp is recorded, not raised');
    assert.equal(rows(roots, 'SELECT 1 FROM project_records').length, 0);
  });

  it('a secret in a required file still blocks at once', () => {
    const { roots, repo } = fixture();
    const secret = `ghp_${'a1B2'.repeat(9)}`;
    const r = onboard(roots, repo, { files: FAST_FILES, stamp: false, inject: `token ${secret}` }, ['--mode', 'fast']);
    assert.equal(r.code, 3, r.stdout + r.stderr);
    assert.equal(validateChecks(roots).find((c) => c.name === 'secrets')?.passed, false);
  });
});

describe('the files read as map documents follow the mapping plan', () => {
  const everything = [...FULL_FILES, dirPath('NOTES.md')].map((p) => (p.startsWith('.planning') ? p : dirPath(p)));
  const staging = { read: (_root: string, path: string) => ok(everything.includes(path) ? `---\nlast_mapped_commit: abc\n---\n# ${path}\n` : null) } as unknown as StagingWorkspace;
  const paths = (mode: 'fast' | 'full' | 'adopt' | 'paths' | 'skip') => {
    const read = readMapDocuments(staging, '/staging', mode);
    assert.ok(read.ok);
    return read.value.map((d) => d.path).sort();
  };

  it('fast reads the four files, full and paths the seven, skip none; never another file under the directory', () => {
    assert.deepEqual(paths('fast'), FAST_FILES.map(dirPath).sort());
    assert.deepEqual(paths('full'), FULL_FILES.map(dirPath).sort());
    assert.deepEqual(paths('paths'), FULL_FILES.map(dirPath).sort());
    assert.deepEqual(paths('skip'), []);
  });

  it('adopt keeps reading every full-map file that exists, so an adopted complete map stays complete', () => {
    assert.deepEqual(paths('adopt'), FULL_FILES.map(dirPath).sort());
  });
});
