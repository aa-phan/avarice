// The drafts of the Phase 2 exit (plan 02-21; D-06, D-09, D-10, D-11): the portfolio's `.avarice/config.json` and the three R1 briefs.
// Each draft is parsed with the real parser, each brief is compiled against the draft conventions (no G0 failure), and, when the owner's
// portfolio checkout is present, every check names a script that exists in its package.json at the pin and every file a brief may write
// exists there. The portfolio is only read, through `git show` and `git cat-file`; nothing is written to it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseBrief } from '../../src/domain/brief.ts';
import type { Brief } from '../../src/domain/brief.ts';
import { checkSpecDigest, parseConventions } from '../../src/domain/conventions.ts';
import type { Conventions } from '../../src/domain/conventions.ts';
import { compileRunContract } from '../../src/domain/run-contract.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const CONFIG = join(ROOT, 'test', 'benchmark', 'portfolio', 'avarice-config.json');
const BRIEFS = ['r1-bug-swipe-nonfinite.md', 'r1-refactor-copy-textarea.md', 'r1-docs-dates-predicate.md'].map((name) => join(ROOT, 'test', 'benchmark', 'r1', name));
const PIN = '9f1cd8d51f83252ad11a8c486c4245b1b9fc3066';
const PORTFOLIO = process.env['AVARICE_PORTFOLIO'] ?? join(homedir(), 'aa-phan-portfolio-v2');

const REQUIRED_CHECKS = ['typecheck', 'lint', 'format:check', 'test', 'check:case', 'check:colors', 'check:contrast', 'build', 'check:meta', 'check:budget', 'check:no-phone', 'check:images'];

function conventions(): Conventions {
  const parsed = parseConventions(readFileSync(CONFIG, 'utf8'));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.value;
}

function brief(path: string): Brief {
  const parsed = parseBrief(readFileSync(path, 'utf8'), { kind: 'file', id: path.split('/').pop() as string });
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.value;
}

// Reads one file of the portfolio at the pin from git objects; null when the portfolio is absent or the path is not in the tree.
function portfolioFile(path: string): string | null {
  if (!existsSync(join(PORTFOLIO, '.git'))) return null;
  const ran = spawnSync('git', ['-C', PORTFOLIO, 'show', `${PIN}:${path}`], { encoding: 'utf8', maxBuffer: 1 << 26 });
  return ran.status === 0 ? ran.stdout : null;
}

const portfolioSkip = existsSync(join(PORTFOLIO, '.git')) ? false : `the portfolio checkout ${PORTFOLIO} is absent`;

describe('the portfolio conventions draft (D-09, D-10, D-11)', () => {
  it('parses with the real parser and declares twelve required checks and one optional, test:e2e', () => {
    const c = conventions();
    assert.deepEqual(c.checks.filter((check) => check.required).map((check) => check.name), REQUIRED_CHECKS);
    assert.deepEqual(c.checks.filter((check) => !check.required).map((check) => check.name), ['test:e2e']);
    assert.equal(c.checks.length, 13);
  });

  it('gives the build and check:meta the public site origin, and the caches each tool writes as declared writes (Pitfall 8)', () => {
    const c = conventions();
    for (const name of ['build', 'check:meta']) {
      assert.equal(c.checks.find((check) => check.name === name)?.env['VITE_SITE_ORIGIN'], 'https://aa-phan.github.io', name);
    }
    const writes = (name: string): string[] => c.checks.find((check) => check.name === name)?.writes ?? [];
    assert.ok(writes('typecheck').includes('node_modules/.tmp/**'));
    assert.ok(writes('test').includes('node_modules/.vite-temp/**') && writes('test').includes('node_modules/.vitest-cache/**') && writes('test').includes('node_modules/.cache/**'));
    assert.ok(writes('build').includes('dist/**'));
    // test:e2e runs the build first, so it writes what the build writes (the dry run found the optional check failing on node_modules/.tmp).
    for (const path of writes('build')) assert.ok(writes('test:e2e').includes(path), `test:e2e declares ${path}`);
  });

  it('installs with npm ci --ignore-scripts through the registry host only, and measures the test inventory with vitest list', () => {
    const c = conventions();
    assert.deepEqual(c.dependencies?.install.slice(0, 3), ['npm', 'ci', '--ignore-scripts']);
    assert.equal(c.dependencies?.lockfile, 'package-lock.json');
    assert.deepEqual(c.dependencies?.registryHosts, ['registry.npmjs.org']);
    assert.deepEqual(c.testInventory?.argv, ['npx', 'vitest', 'list']);
    assert.ok(c.testInventory?.globs.includes('tests/unit/**/*.test.ts'));
  });

  it('protects the check configuration, the e2e specs and the fixtures, and keeps them out of the write set', () => {
    const c = conventions();
    for (const path of ['scripts/**', 'tests/e2e/**', 'tests/setup.ts', 'vite.config.ts', 'vitest.config.ts', '.oxlintrc.json', 'prettier.config.mjs']) {
      assert.ok(c.paths.protected.includes(path), path);
    }
    assert.deepEqual(c.paths.write, ['src/**', 'tests/unit/**', 'docs/**']);
  });

  it('grants the agent no command that starts with git, avarice, claude or a network tool (parser refusal) and names the checks it may run', () => {
    const c = conventions();
    assert.ok(c.agentCommands.includes('npm run typecheck'));
    assert.ok(c.agentCommands.includes('npx vitest run <paths>'));
  });

  it('every check names a script that exists in the portfolio package.json at the pin', { skip: portfolioSkip }, () => {
    const text = portfolioFile('package.json');
    assert.notEqual(text, null, 'package.json at the pin');
    const scripts = (JSON.parse(text as string) as { scripts: Record<string, string> }).scripts;
    for (const check of conventions().checks) {
      const [bin, sub, script] = check.argv;
      assert.equal(bin, 'npm', `${check.name} runs through npm`);
      if (sub === 'run') assert.ok(script !== undefined && Object.hasOwn(scripts, script), `${check.name}: npm run ${script} is not a script at the pin`);
      assert.equal(script, check.name, `${check.name} runs the script of its own name`);
    }
  });

  it('the package scripts the verify chain runs are exactly the twelve required checks, in order', { skip: portfolioSkip }, () => {
    const text = portfolioFile('package.json');
    const scripts = (JSON.parse(text as string) as { scripts: Record<string, string> }).scripts;
    const chain = (scripts['verify'] as string).split(' && ').map((step) => step.replace(/^npm run /, '').replace(/^npm test$/, 'test'));
    assert.deepEqual(chain, REQUIRED_CHECKS);
  });
});

describe('the three R1 briefs (D-06)', () => {
  it('there is one brief per class: a bug fix with a failing test, a small refactor, docs plus code', () => {
    assert.equal(BRIEFS.length, 3);
    for (const path of BRIEFS) assert.ok(existsSync(path), path);
  });

  for (const path of BRIEFS) {
    const name = path.split('/').pop() as string;

    it(`${name} parses, names the pin, expects no decisions and maps every criterion to a deterministic check`, () => {
      const b = brief(path);
      assert.equal(b.expectedDecisions, 0);
      assert.ok(PIN.startsWith(b.baseRevision as string));
      assert.ok(b.acceptance.length >= 2);
      for (const criterion of b.acceptance) assert.ok(criterion.verifiedBy.length > 0, `${criterion.id} has verifiedBy`);
      assert.ok(b.targetChecks.includes('test'));
    });

    it(`${name} compiles against the draft conventions without a G0 failure, with a write set inside the conventions`, () => {
      const b = brief(path);
      const compiled = compileRunContract({
        runId: 'run_ExitDraft01',
        projectId: 'portfolio',
        baseRevision: PIN,
        conventionsRevision: 'abcdef1234567',
        brief: b,
        conventions: conventions(),
        nowIso: '2026-11-06T00:00:00.000Z',
        policy: 'routine',
      });
      assert.ok(compiled.ok, JSON.stringify(compiled));
      const contract = compiled.value.contract;
      assert.deepEqual(contract.files.write, b.write);
      assert.equal(contract.verification.requiredChecks.length, 12);
      assert.ok(!contract.verification.requiredChecks.includes('test:e2e'));
      assert.equal(contract.execution.supervisorEndpoints[0], 'registry.npmjs.org');
    });

    it(`${name} writes only files that exist at the pin, and every check it names is declared`, { skip: portfolioSkip }, () => {
      const b = brief(path);
      for (const file of b.write ?? []) assert.notEqual(portfolioFile(file), null, `${file} is in the portfolio tree at the pin`);
      const declared = new Set(conventions().checks.map((check) => check.name));
      for (const criterion of b.acceptance) {
        for (const ref of criterion.verifiedBy.filter((r) => r.startsWith('check:'))) assert.ok(declared.has(ref.slice(6)), `${criterion.id}: ${ref}`);
      }
    });
  }

  it('the refactor brief keeps tests/unit/copy.test.ts unchanged by writing only src/lib/copy.ts, and the copy test exists at the pin', { skip: portfolioSkip }, () => {
    const b = brief(BRIEFS[1] as string);
    assert.deepEqual(b.write, ['src/lib/copy.ts']);
    assert.notEqual(portfolioFile('tests/unit/copy.test.ts'), null);
  });

  it('the bug brief names a swipeDirection describe block that exists at the pin, and the docs brief a "Content model" section', { skip: portfolioSkip }, () => {
    assert.match(portfolioFile('tests/unit/swipe-step.test.ts') as string, /describe\('swipeDirection'/);
    assert.match(portfolioFile('docs/architecture.md') as string, /^## Content model$/m);
    assert.match(portfolioFile('tests/unit/dates.test.ts') as string, /describe\('monthYear'/);
  });

  it('the checks digest is stable across a parse of the same text (the preflight compares it)', () => {
    assert.equal(checkSpecDigest(conventions().checks), checkSpecDigest(conventions().checks));
  });
});
