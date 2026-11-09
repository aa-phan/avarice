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
import type { IndexFacts } from '../../src/domain/run-contract.ts';

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

// ---------------------------------------------------------------------------------------------------------------
// The three Phase 3 exit briefs (plan 03-28; D-01 to D-04). Each plants one owner-choice criterion (`decision:<key>`) in one item and has
// an item that does not depend on it and writes no file the planted item writes, so the independent item can be committed while the
// planted one waits. They are compiled against the conventions the owner committed as 9f63d91 (the draft file is their test double).
// ---------------------------------------------------------------------------------------------------------------

const CONVENTIONS_COMMIT = '9f63d91';
const PHASE3_DIR = join(ROOT, 'test', 'benchmark', 'phase3');
const PHASE3_BRIEFS = [
  { file: 'p3-run1-copy-fallback.md', key: 'fallback-wording', planted: 'B', independent: 'A', dependent: 'C', created: [] as string[] },
  { file: 'p3-run2-graduation-label.md', key: 'graduation-wording', planted: 'B', independent: 'A', dependent: undefined, created: [] as string[] },
  { file: 'p3-run3-theme-toggle.md', key: 'toggle-pattern', planted: 'B', independent: 'A', dependent: undefined, created: ['tests/unit/theme-toggle.test.tsx'] },
];

// The files of the portfolio tree at the pin, the index facts a real start would hand the compiler for item derivation (D-07 stage 1).
function pinTreeFacts(): IndexFacts | undefined {
  if (!existsSync(join(PORTFOLIO, '.git'))) return undefined;
  const ran = spawnSync('git', ['-C', PORTFOLIO, 'ls-tree', '-r', '--name-only', PIN], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (ran.status !== 0) return undefined;
  return { files: ran.stdout.split('\n').filter((l) => l !== ''), symbolsByFile: {} };
}

function dependsTransitively(brief: Brief, from: string, target: string, seen: Set<string> = new Set()): boolean {
  const item = brief.items?.find((i) => i.id === from);
  for (const dep of item?.dependsOn ?? []) {
    if (dep === target) return true;
    if (!seen.has(dep)) {
      seen.add(dep);
      if (dependsTransitively(brief, dep, target, seen)) return true;
    }
  }
  return false;
}

describe('the three Phase 3 exit briefs (plan 03-28, D-02 to D-04)', () => {
  it('there is one brief per D-03 run', () => {
    assert.equal(PHASE3_BRIEFS.length, 3);
    for (const { file } of PHASE3_BRIEFS) assert.ok(existsSync(join(PHASE3_DIR, file)), file);
  });

  for (const spec of PHASE3_BRIEFS) {
    const path = join(PHASE3_DIR, spec.file);

    it(`${spec.file} parses, names the pin, expects one decision and plants exactly one decision:${spec.key} criterion in item ${spec.planted}`, () => {
      const b = brief(path);
      assert.equal(b.expectedDecisions, 1);
      assert.ok(PIN.startsWith(b.baseRevision as string));
      assert.ok(b.items !== undefined && b.items.length >= 2, 'items');
      const decisionRefs = b.acceptance.flatMap((c) => c.verifiedBy.filter((r) => r.startsWith('decision:')).map((r) => ({ id: c.id, ref: r })));
      assert.deepEqual(decisionRefs.map((d) => d.ref), [`decision:${spec.key}`]);
      const planted = b.items?.find((i) => i.id === spec.planted);
      assert.ok(planted?.acceptance.includes(decisionRefs[0]?.id as string), `the decision criterion belongs to item ${spec.planted}`);
      // The criterion that carries the choice also names the check and test that verify the choice once it is made (G0).
      const carrier = b.acceptance.find((c) => c.id === decisionRefs[0]?.id);
      assert.ok(carrier?.verifiedBy.some((r) => r.startsWith('check:') || r.startsWith('test:')));
      for (const criterion of b.acceptance) assert.ok(criterion.verifiedBy.length > 0, `${criterion.id} has verifiedBy`);
      assert.ok(b.targetChecks.includes('test'));
    });

    it(`${spec.file} has item ${spec.independent}, which does not depend on item ${spec.planted} and has no decision criterion`, () => {
      const b = brief(path);
      const independent = b.items?.find((i) => i.id === spec.independent);
      assert.ok(independent !== undefined);
      assert.ok(!dependsTransitively(b, spec.independent, spec.planted), 'the independent item depends on the planted one');
      for (const id of independent.acceptance) {
        assert.ok(!b.acceptance.find((c) => c.id === id)?.verifiedBy.some((r) => r.startsWith('decision:')), `${id} carries a decision`);
      }
      if (spec.dependent !== undefined) assert.ok(dependsTransitively(b, spec.dependent, spec.planted), `item ${spec.dependent} depends on item ${spec.planted}`);
    });

    it(`${spec.file} compiles against the portfolio conventions without a G0 failure; every criterion is in one item and every write path is inside the write set`, () => {
      const b = brief(path);
      const compiled = compileRunContract({
        runId: 'run_Phase3Draft01',
        projectId: 'portfolio',
        baseRevision: PIN,
        conventionsRevision: CONVENTIONS_COMMIT,
        brief: b,
        conventions: conventions(),
        nowIso: '2026-11-09T00:00:00.000Z',
        policy: 'routine',
      });
      assert.ok(compiled.ok, JSON.stringify(compiled));
      const contract = compiled.value.contract;
      assert.deepEqual(contract.files.write, b.write);
      assert.equal(contract.verification.requiredChecks.length, 12);
      assert.equal(contract.intent.workItems.length, b.items?.length);
      const owned = contract.intent.workItems.flatMap((i) => i.acceptance).sort();
      assert.deepEqual(owned, b.acceptance.map((c) => c.id).sort(), 'every acceptance criterion is in exactly one item');
      // D-12: invocations = items x 2 + 1, 10.00 USD per run, 2.00 per invocation; a lowered per-run cap compiles and only lowers.
      assert.equal(contract.budgets.invocations, contract.intent.workItems.length * 2 + 1);
      assert.equal(contract.budgets.costUsd.perRun, 10);
      const lowered = compileRunContract({
        runId: 'run_Phase3Draft02',
        projectId: 'portfolio',
        baseRevision: PIN,
        conventionsRevision: CONVENTIONS_COMMIT,
        brief: b,
        conventions: conventions(),
        nowIso: '2026-11-09T00:00:00.000Z',
        policy: 'routine',
        budgetOverrides: { costUsdPerRun: 5.67 },
      });
      assert.ok(lowered.ok, JSON.stringify(lowered));
      assert.equal(lowered.value.contract.budgets.costUsd.perRun, 5.67);
    });

    it(`${spec.file}: the planted item and the independent item share no file the compiler derives for them, and every file the run writes exists at the pin or is created by the brief`, { skip: portfolioSkip }, () => {
      const b = brief(path);
      const facts = pinTreeFacts();
      assert.ok(facts !== undefined);
      const compiled = compileRunContract({
        runId: 'run_Phase3Draft03',
        projectId: 'portfolio',
        baseRevision: PIN,
        conventionsRevision: CONVENTIONS_COMMIT,
        brief: b,
        conventions: conventions(),
        nowIso: '2026-11-09T00:00:00.000Z',
        policy: 'routine',
        indexFacts: facts,
      });
      assert.ok(compiled.ok, JSON.stringify(compiled));
      const items = compiled.value.contract.intent.workItems;
      const planted = items.find((i) => i.id === spec.planted);
      const independent = items.find((i) => i.id === spec.independent);
      assert.ok(planted !== undefined && independent !== undefined);
      // A derived list of the whole write set would mean the item named no file of its own, and could not be told apart from the other.
      assert.ok(planted.spec.files.length < (b.write ?? []).length, `item ${spec.planted} names its own files`);
      assert.ok(independent.spec.files.length < (b.write ?? []).length, `item ${spec.independent} names its own files`);
      assert.deepEqual(planted.spec.files.filter((f) => independent.spec.files.includes(f)), [], 'the two items share a file');
      for (const file of b.write ?? []) {
        if (spec.created.includes(file)) assert.equal(portfolioFile(file), null, `${file} is created by the brief and is absent at the pin`);
        else assert.notEqual(portfolioFile(file), null, `${file} is in the portfolio tree at the pin`);
      }
      const declared = new Set(conventions().checks.map((check) => check.name));
      for (const criterion of b.acceptance) {
        for (const ref of criterion.verifiedBy.filter((r) => r.startsWith('check:'))) assert.ok(declared.has(ref.slice(6)), `${criterion.id}: ${ref}`);
      }
    });
  }

  it('the planted ambiguities are real at the pin: the copy fallback, the date-copy owner decision and the toggle pattern', { skip: portfolioSkip }, () => {
    assert.match(portfolioFile('src/lib/copy.ts') as string, /export const COPY_FALLBACK = /);
    assert.match(portfolioFile('tests/unit/date-copy.test.ts') as string, /The wording after December 2026 is an owner decision/);
    assert.match(portfolioFile('src/components/ui/ThemeToggle.tsx') as string, /aria-pressed=\{dark\}[\s\S]*aria-label="Dark theme"/);
    assert.match(portfolioFile('src/lib/theme.ts') as string, /function isTheme\(/);
    assert.notEqual(portfolioFile('tests/unit/theme.test.ts'), null);
  });

  it('the conventions committed as 9f63d91 are the draft the briefs are compiled against (D-01)', { skip: portfolioSkip }, () => {
    const ran = spawnSync('git', ['-C', PORTFOLIO, 'show', `${CONVENTIONS_COMMIT}:.avarice/config.json`], { encoding: 'utf8', maxBuffer: 1 << 26 });
    assert.equal(ran.status, 0, 'the conventions commit is in the portfolio');
    const committed = parseConventions(ran.stdout);
    assert.ok(committed.ok, JSON.stringify(committed));
    assert.deepEqual(committed.value, conventions());
  });

  it('the recorded dry run (03-28-dry-run.json) names the digest of each brief file as it is now', () => {
    const record = join(ROOT, '.planning', 'phases', '03-decisions-independent-work-and-amendments', '03-28-dry-run.json');
    assert.ok(existsSync(record), 'run scripts/exit-run-phase3.sh --dry-run');
    const dry = JSON.parse(readFileSync(record, 'utf8')) as { briefs: Array<{ path: string; digest: string; compiled: boolean }>; spentUsd: number };
    assert.equal(dry.spentUsd, 0);
    assert.equal(dry.briefs.length, 3);
    for (const { file } of PHASE3_BRIEFS) {
      const entry = dry.briefs.find((b) => b.path.endsWith(`/${file}`));
      assert.ok(entry?.compiled, `${file} compiled in the dry run`);
      assert.equal(entry.digest, brief(join(PHASE3_DIR, file)).digest, `${file} changed after the dry run: run it again`);
    }
  });
});
