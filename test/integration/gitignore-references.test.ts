// Deferred item 10 (plan 01-19 gap fix): a path reference matched by the repository's own committed `.gitignore` rules, read from git
// objects at the pin and matched by git itself, counts as known (declared build output or local config), not dangling. The 5% limit
// stays. Scratch repositories under os.tmpdir() only; the user's checkout, the staging clone's working tree and the machine's own
// git excludes are never a source of rules.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CloneStagingWorkspace } from '../../src/adapters/git/staging-clone.ts';
import { danglingShare, extractPathReferences } from '../../src/domain/path-references.ts';
import { AVARICE_TRACKED_WRITABLE, AVARICE_WRITE_SET, STAGING_SCAFFOLD } from '../../src/domain/validation.ts';
import { FULL_MAP_FILES } from '../../src/domain/mapping.ts';
import type { Result } from '../../src/domain/result.ts';
import { REPO_ROOT, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { checkoutSnapshot, git, makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo, ScratchRepoOptions } from '../helpers/scratch-repo.ts';

const TEST_CLI = join(REPO_ROOT, 'test', 'helpers', 'test-cli.ts');
const ONB = 'onb_01IGNORERULES0000000000000';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function must<T>(result: Result<T>): T {
  assert.ok(result.ok, result.ok ? '' : `expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

function scratch(options: ScratchRepoOptions): ScratchRepo {
  const repo = makeScratchRepo(options);
  cleanup.push(repo.base);
  return repo;
}

function stagingOf(repo: ScratchRepo, pin = repo.head): { ws: CloneStagingWorkspace; staging: string; workRoot: string } {
  const workRoot = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-ignore-work-')));
  cleanup.push(workRoot);
  const ws = new CloneStagingWorkspace();
  const info = must(ws.prepare({ repoPath: repo.path, workRoot, onboardingId: ONB, pin }));
  return { ws, staging: info.path, workRoot };
}

const RULES = ['dist/', 'node_modules', '*.local', '!keep.local', '/rootonly', ''].join('\n');
const FILES = { 'README.md': '# scratch\n', 'src/x.ts': 'export const x = 1;\n', '.gitignore': RULES, 'sub/.gitignore': 'gen\n' };

describe('ignoredByCommittedRules: git matches the committed .gitignore files at the pin', () => {
  it('returns exactly the candidates the rules ignore: directory rules, anchored rules, nested files, negation, parents of ignored directories', () => {
    const repo = scratch({ files: FILES });
    const { ws, staging } = stagingOf(repo);
    const candidates = [
      'dist', 'dist/index.html', 'dist/resume.pdf', 'node_modules', 'node_modules/.bin/oxlint', 'a.local', 'keep.local', 'rootonly', 'sub/rootonly',
      'sub/gen', 'sub/x/gen', 'gen', 'src/x.ts', 'README.md', 'distant/x.js', '.env',
    ];
    const ignored = must(ws.ignoredByCommittedRules(staging, repo.head, candidates));
    assert.deepEqual(ignored, ['dist', 'dist/index.html', 'dist/resume.pdf', 'node_modules', 'node_modules/.bin/oxlint', 'a.local', 'rootonly', 'sub/gen', 'sub/x/gen']);
  });

  it('answers an empty list for no candidates and for a repository with no .gitignore', () => {
    const repo = scratch({ files: { 'README.md': '# scratch\n' } });
    const { ws, staging } = stagingOf(repo);
    assert.deepEqual(must(ws.ignoredByCommittedRules(staging, repo.head, ['dist', 'src/x.ts'])), []);
    assert.deepEqual(must(ws.ignoredByCommittedRules(staging, repo.head, [])), []);
  });

  it('reads the rules from the pin, not from any working tree: staging edits, the user checkout, .git/info/exclude and the user and system excludes add nothing', () => {
    const repo = scratch({ files: FILES, modified: { '.gitignore': `${RULES}\nsrc/\nREADME.md\n` } });
    const pin = git(repo.path, ['rev-parse', 'HEAD']).trim();
    const { ws, staging } = stagingOf(repo, pin);
    // The staging copy's own working tree and exclude file, as a contained mapper could leave them.
    writeFileSync(join(staging, '.gitignore'), `${RULES}\nsrc/\n`);
    writeFileSync(join(staging, '.git', 'info', 'exclude'), 'README.md\n');
    // The machine's global excludes (what git reads from $HOME/.config/git/ignore).
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-ignore-home-')));
    cleanup.push(home);
    mkdirSync(join(home, '.config', 'git'), { recursive: true });
    writeFileSync(join(home, '.config', 'git', 'ignore'), '*.pdf\n');
    const savedHome = process.env['HOME'];
    process.env['HOME'] = home;
    try {
      const ignored = must(ws.ignoredByCommittedRules(staging, pin, ['src/x.ts', 'README.md', 'dist/resume.pdf', 'a.pdf', 'dist']));
      assert.deepEqual(ignored, ['dist/resume.pdf', 'dist']);
    } finally {
      if (savedHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = savedHome;
    }
  });

  it('does not honour a .gitignore that is a symbolic link in the tree', () => {
    const repo = scratch({ files: FILES });
    mkdirSync(join(repo.path, 'link'));
    // The link target text is itself a valid rule (`gen`), so a reader that treated the link's blob as a rule file would ignore link/gen.
    symlinkSync('gen', join(repo.path, 'link', '.gitignore'));
    git(repo.path, ['add', '-A']);
    git(repo.path, ['-c', 'user.name=Scratch', '-c', 'user.email=scratch@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'link']);
    const pin = git(repo.path, ['rev-parse', 'HEAD']).trim();
    const { ws, staging } = stagingOf(repo, pin);
    assert.deepEqual(must(ws.ignoredByCommittedRules(staging, pin, ['link/gen', 'sub/gen'])), ['sub/gen']);
  });

  it('treats a repository with more .gitignore files than it will read as having no rule at all (it never loosens by guessing)', () => {
    const files: Record<string, string> = { 'README.md': '# scratch\n' };
    for (let i = 0; i < 201; i += 1) files[`d${i}/.gitignore`] = '*.x\n';
    const repo = scratch({ files });
    const { ws, staging } = stagingOf(repo);
    assert.deepEqual(must(ws.ignoredByCommittedRules(staging, repo.head, ['d0/a.x', 'd200/b.x'])), []);
  });

  it('leaves nothing behind in the onboarding directory and does not touch the user checkout', () => {
    const repo = scratch({ files: FILES });
    const before = checkoutSnapshot(repo.path);
    const { ws, staging } = stagingOf(repo);
    const onboardingDir = dirname(staging);
    const listing = readdirSync(onboardingDir).sort();
    must(ws.ignoredByCommittedRules(staging, repo.head, ['dist', 'src/x.ts']));
    assert.deepEqual(readdirSync(onboardingDir).sort(), listing);
    assert.deepEqual(checkoutSnapshot(repo.path), before);
  });

  it('refuses a pin that is not a full commit SHA, and a candidate that could be read as an option', () => {
    const repo = scratch({ files: FILES });
    const { ws, staging } = stagingOf(repo);
    assert.equal(ws.ignoredByCommittedRules(staging, 'HEAD', ['dist']).ok, false);
    assert.deepEqual(must(ws.ignoredByCommittedRules(staging, repo.head, ['--stdin', '-q', 'dist'])), ['dist']);
  });
});

// The real full map of ~/aa-phan-portfolio-v2 from the 01-19 rehearsal 3 (test/fixtures/live-full-map: the seven documents the mapper
// wrote, the tracked paths and the root .gitignore at the pin). 32 of 311 named paths dangled before this rule, 28 after.
describe('the real full map of the exit rehearsal', () => {
  const fixture = (name: string): string => readFileSync(join(REPO_ROOT, 'test', 'fixtures', 'live-full-map', name), 'utf8');
  const documents = FULL_MAP_FILES.map((path) => ({ path, text: fixture(path.split('/').at(-1) as string) }));
  const tracked = fixture('tracked-paths.txt').split('\n').filter((line) => line.length > 0);
  const refs = documents.flatMap((d) => extractPathReferences(d.text));
  const known = [...tracked, ...documents.map((d) => d.path), '.planning/config.json'];
  const own = [...AVARICE_WRITE_SET, ...AVARICE_TRACKED_WRITABLE, ...STAGING_SCAFFOLD];

  it('dangled at 32 of 311 before the rule, and the remaining tokens after it are the ones the user wants to see', () => {
    const before = danglingShare(refs, known, own);
    assert.equal(before.total, 311);
    assert.equal(before.dangling.length, 32);

    const repo = scratch({ files: { '.gitignore': fixture('repo-gitignore.txt'), 'README.md': '# the portfolio stand-in\n' } });
    const { ws, staging } = stagingOf(repo);
    const unique = [...new Set(refs)];
    const ignored = must(ws.ignoredByCommittedRules(staging, repo.head, unique));
    // git's own matching: the unanchored rule `dist` also matches `lenis/dist/lenis.css`, a path inside an npm package.
    const forgiven = ['lenis/dist/lenis.css', 'dist', 'node_modules', 'node_modules/.bin/oxlint'];
    assert.deepEqual(ignored.filter((r) => before.dangling.includes(r)), forgiven);

    const after = danglingShare(refs, known, own, ignored);
    assert.equal(after.total, 311);
    assert.deepEqual(after.ignored, forgiven.slice(0).sort((a, b) => unique.indexOf(a) - unique.indexOf(b)));
    assert.deepEqual(after.dangling, before.dangling.filter((r) => !forgiven.includes(r)));
    assert.equal(after.dangling.length, 28);
    // Still above the 5% limit: this rule alone does not make the real map pass. Nothing else was relaxed.
    assert.ok(after.share > 0.05, `${after.share}`);
  });
});

// End to end with the fake host: the map documents name build output the repository's own .gitignore declares.
describe('validation through the CLI', () => {
  const IGNORED_REFS = Array.from({ length: 10 }, (_, i) => `dist/out-${i}.js`);
  const inject = `The bundler writes ${IGNORED_REFS.map((p) => `\`${p}\``).join(', ')}.`;
  const injectMissing = `The bundler writes ${IGNORED_REFS.map((p) => `\`${p.replace('dist/', 'build/')}\``).join(', ')}.`;

  function onboard(repo: ScratchRepo, roots: CliRoots, host: object) {
    return runCli(['onboard', '--policy', 'onboarding', repo.path], { roots, entry: TEST_CLI, env: { AVARICE_FAKE_HOST: JSON.stringify(host) } });
  }
  function fixture(gitignore: string): { repo: ScratchRepo; roots: CliRoots } {
    const roots = makeRoots();
    const repo = makeScratchRepo({ files: { 'README.md': '# scratch\n', 'package.json': '{"name":"scratch"}\n', 'src/index.ts': 'export const answer = 42;\n', '.gitignore': gitignore } });
    cleanup.push(roots.base, repo.base);
    return { repo, roots };
  }
  function pathReferencesCheck(roots: CliRoots): { passed: boolean; detail: string } | undefined {
    const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
    try {
      const row = db.prepare("SELECT result_json FROM onboarding_steps WHERE step = 'validate' ORDER BY attempt DESC").get() as { result_json: string } | undefined;
      const checks = (JSON.parse(row?.result_json ?? '{}') as { checks?: Array<{ name: string; passed: boolean; detail: string }> }).checks ?? [];
      return checks.find((c) => c.name === 'path-references');
    } finally {
      db.close();
    }
  }

  it('accepts a map whose dangling references are build output the repository ignores', () => {
    const { repo, roots } = fixture('dist\n');
    const r = onboard(repo, roots, { inject });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(pathReferencesCheck(roots)?.detail ?? '', /^0 of \d+ named path\(s\) dangling/);
    assert.match(pathReferencesCheck(roots)?.detail ?? '', /10 .*ignored by the repository's own \.gitignore/);
  });

  it('still rejects the same references when the repository does not ignore them', () => {
    const { repo, roots } = fixture('coverage\n');
    const r = onboard(repo, roots, { inject });
    assert.equal(r.code, 3, r.stdout + r.stderr);
    assert.equal(pathReferencesCheck(roots)?.passed, false);
  });

  it('still rejects references the rules do not cover', () => {
    const { repo, roots } = fixture('dist\n');
    const r = onboard(repo, roots, { inject: injectMissing });
    assert.equal(r.code, 3, r.stdout + r.stderr);
    assert.equal(pathReferencesCheck(roots)?.passed, false);
  });
});
