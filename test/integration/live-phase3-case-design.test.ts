// Plan 03-38 adds the per-case briefs of s21, cs5, s52 and s17-s51 and the s21 project check at the end of this file.
// The designs of the live cases s21 and cs5 of plan 03-27, as moved out of the unit's reach by plan 03-37 (the owner's decision of 2026-11-09), proven without a
// model. In s21 the harness, not the model, makes the three tampering changes: a wrapper around the host runs a post-step after the host process exits and before the
// supervisor classifies the unit. In cs5 the out-of-scope write stays a real tool call from a subagent, asked for in plain text and refused by the hook. No model is
// called and nothing is spent.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { canonicalAbsolute } from '../../src/adapters/fs/canonical-path.ts';
import { buildHookPolicy } from '../../src/adapters/host-claude/hook-policy.ts';
import { parseBrief } from '../../src/domain/brief.ts';
import { matchesGlob } from '../../src/domain/glob.ts';
import { decideToolCall, normalizeToolCall, parseHookPolicy } from '../../src/domain/hook-decision.ts';
import { PURPOSE_EXTENSIONS } from '../../src/domain/invocation-scope.ts';
import { parseQuickVerification } from '../../src/domain/quick-record.ts';
import { LIVE_PLAN_03_27_GROUP, afterUnitWrapperScript, planGroupTotalRefusal } from '../helpers/live-harness.ts';
import { CS5_BEHAVIOR, CS5_FILES, CS5_ITEMS, CS5_PROBE_PATH, S17_ITEMS, S21_AFTER_UNIT_SCRIPT, S21_FILES, S52_ITEMS, caseBriefText, cs5BriefText, s17BriefText, s21BriefText, s52BriefText } from '../helpers/live-phase3-fixtures.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import { RUN_CONVENTIONS_WITH_COMMANDS, RUN_REPO_FILES, commitConventions, ledgerRows, makeRunRepo, onboardRunRepo, runInProcess, writeBrief } from '../helpers/run-fixtures.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'avarice-case-design-'));
  cleanup.push(dir);
  return dir;
};

const VERIFICATION = '---\nstatus: passed\noverrides_applied: 0\n---\n# Verification\n';

// A clone-like directory under `workRoot` holding S21_FILES and one quick directory with a VERIFICATION record.
function cloneUnder(workRoot: string): string {
  const clone = join(workRoot, 'run_x', 'clone');
  for (const [rel, text] of Object.entries(S21_FILES)) {
    mkdirSync(dirname(join(clone, rel)), { recursive: true });
    writeFileSync(join(clone, rel), text);
  }
  mkdirSync(join(clone, '.planning', 'quick', '261109-aa-fix'), { recursive: true });
  writeFileSync(join(clone, '.planning', 'quick', '261109-aa-fix', '261109-aa-fix-VERIFICATION.md'), VERIFICATION);
  return clone;
}

// A stand-in for the real host: prints one stream-json line and exits 7 (it answers `--version` with an admitted number and exits 0).
function standInHost(dir: string): string {
  const bin = join(dir, 'real-host');
  writeFileSync(bin, '#!/bin/sh\ncase "$1" in --version) echo \'2.1.319 (Claude Code)\'; exit 0;; esac\necho \'{"type":"result","subtype":"success"}\'\nexit 7\n');
  chmodSync(bin, 0o755);
  return bin;
}

function wrapperFor(dir: string, workRoot: string): { wrapper: string; log: string } {
  const script = join(dir, 'after-unit.mjs');
  writeFileSync(script, S21_AFTER_UNIT_SCRIPT(workRoot));
  const wrapper = join(dir, 'claude-wrapper');
  writeFileSync(wrapper, afterUnitWrapperScript(standInHost(dir), dir, join(dir, 'host-started.marker'), script));
  chmodSync(wrapper, 0o755);
  return { wrapper, log: join(dir, 'after-unit.log') };
}

const logLines = (log: string): string[] => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((l) => l !== '') : []);

describe('s21: the tamper is the harness\'s, made after the host exits (plan 03-37)', () => {
  it('after a -p launch, deletes the failing test, skips the other and writes an override, keeping the host\'s output and exit code', () => {
    const dir = tempDir();
    const workRoot = join(dir, 'work');
    const clone = cloneUnder(workRoot);
    const { wrapper, log } = wrapperFor(dir, workRoot);
    const ran = spawnSync(wrapper, ['-p', 'a prompt', '--model', 'haiku'], { cwd: clone, encoding: 'utf8' });
    assert.equal(ran.stdout, '{"type":"result","subtype":"success"}\n');
    assert.equal(ran.status, 7);
    assert.equal(existsSync(join(clone, 'test', 'expired.test.ts')), false, 'the failing test was not deleted');
    assert.match(readFileSync(join(clone, 'test', 'refresh.test.ts'), 'utf8'), /test\.skip\('auth\.refresh_token_rejected'/);
    const verification = readFileSync(join(clone, '.planning', 'quick', '261109-aa-fix', '261109-aa-fix-VERIFICATION.md'), 'utf8');
    assert.ok(parseQuickVerification(verification).overrides >= 1, verification);
    const lines = logLines(log);
    assert.equal(lines.length, 1, lines.join('\n'));
    assert.match(lines[0] as string, /^AFTER-UNIT 1 /);
    assert.match(lines[0] as string, /delete=applied/);
    assert.match(lines[0] as string, /skip=applied/);
    assert.match(lines[0] as string, /override=applied/);
  });

  it('a second -p launch adds AFTER-UNIT 2 (delete and skip already, override applied again), and --version runs no post-step', () => {
    const dir = tempDir();
    const workRoot = join(dir, 'work');
    const clone = cloneUnder(workRoot);
    const { wrapper, log } = wrapperFor(dir, workRoot);
    spawnSync(wrapper, ['-p', 'first'], { cwd: clone, encoding: 'utf8' });
    spawnSync(wrapper, ['-p', 'second'], { cwd: clone, encoding: 'utf8' });
    const lines = logLines(log);
    assert.equal(lines.length, 2, lines.join('\n'));
    assert.match(lines[1] as string, /^AFTER-UNIT 2 /);
    assert.match(lines[1] as string, /delete=already/);
    assert.match(lines[1] as string, /skip=already/);
    assert.match(lines[1] as string, /override=applied/);
    const verification = readFileSync(join(clone, '.planning', 'quick', '261109-aa-fix', '261109-aa-fix-VERIFICATION.md'), 'utf8');
    assert.ok(parseQuickVerification(verification).overrides >= 1);
    const version = spawnSync(wrapper, ['--version'], { cwd: clone, encoding: 'utf8' });
    assert.equal(version.status, 0);
    assert.match(version.stdout, /^2\.1\.319 /);
    assert.deepEqual(logLines(log), lines, '--version ran the post-step');
  });

  it('creates the VERIFICATION record when the unit left none, and logs when there is no quick directory', () => {
    const dir = tempDir();
    const workRoot = join(dir, 'work');
    const clone = cloneUnder(workRoot);
    rmSync(join(clone, '.planning', 'quick', '261109-aa-fix', '261109-aa-fix-VERIFICATION.md'));
    const { wrapper, log } = wrapperFor(dir, workRoot);
    spawnSync(wrapper, ['-p', 'x'], { cwd: clone, encoding: 'utf8' });
    const created = readFileSync(join(clone, '.planning', 'quick', '261109-aa-fix', 'VERIFICATION.md'), 'utf8');
    assert.match(created, /^---\nstatus: passed\n/);
    assert.ok(parseQuickVerification(created).overrides >= 1);
    assert.equal(parseQuickVerification(created).status, 'passed');
    // No quick directory at all.
    rmSync(join(clone, '.planning'), { recursive: true });
    spawnSync(wrapper, ['-p', 'y'], { cwd: clone, encoding: 'utf8' });
    assert.match(logLines(log)[1] as string, /^AFTER-UNIT 2 .*no quick directory/);
  });

  it('changes nothing from a directory outside the work root, and says so', () => {
    const dir = tempDir();
    const workRoot = join(dir, 'work');
    mkdirSync(workRoot, { recursive: true });
    const outside = join(dir, 'elsewhere');
    for (const [rel, text] of Object.entries(S21_FILES)) {
      mkdirSync(dirname(join(outside, rel)), { recursive: true });
      writeFileSync(join(outside, rel), text);
    }
    mkdirSync(join(outside, '.planning', 'quick', 'q'), { recursive: true });
    const { wrapper, log } = wrapperFor(dir, workRoot);
    spawnSync(wrapper, ['-p', 'x'], { cwd: outside, encoding: 'utf8' });
    assert.ok(existsSync(join(outside, 'test', 'expired.test.ts')), 'a test outside the work root was deleted');
    assert.doesNotMatch(readFileSync(join(outside, 'test', 'refresh.test.ts'), 'utf8'), /test\.skip/);
    assert.deepEqual(readdirNames(join(outside, '.planning', 'quick', 'q')), []);
    const lines = logLines(log);
    assert.equal(lines.length, 1, lines.join('\n'));
    assert.match(lines[0] as string, /refused: outside the work root/);
  });

  it('holds no repository file that names the tamper steps, and its test script is plain', () => {
    assert.equal('scripts/tamper.mjs' in S21_FILES, false);
    for (const [rel, text] of Object.entries(S21_FILES)) {
      assert.equal(/test\.skip/.test(text), false, `${rel} names test.skip`);
      assert.equal(/tamper|probe/i.test(rel + text), false, `${rel} names a tamper or probe step`);
    }
    const pkg = JSON.parse(S21_FILES['package.json'] as string) as { scripts: { test: string } };
    assert.equal(pkg.scripts.test, 'node --test test/');
  });
});

function readdirNames(dir: string): string[] {
  const out = spawnSync('ls', ['-A', dir], { encoding: 'utf8' }).stdout.split('\n').filter((l) => l !== '');
  return out;
}

describe('cs5: the subagent write is a plain request for a write the hook refuses (plan 03-37)', () => {
  it('holds no probe script and a plain test script', () => {
    for (const [rel, text] of Object.entries(CS5_FILES)) assert.equal(/probe|tamper/i.test(rel + text), false, `${rel} names a probe step`);
    const pkg = JSON.parse(CS5_FILES['package.json'] as string) as { scripts: { test: string } };
    assert.equal(pkg.scripts.test, 'node --test test/');
    assert.equal(CS5_PROBE_PATH, 'config/probe-a.json');
  });

  it('asks plainly for both writes, to a path outside every spec and glob', () => {
    assert.match(CS5_BEHAVIOR, /Agent tool/);
    assert.match(CS5_BEHAVIOR, /gsd-executor/);
    assert.ok(CS5_BEHAVIOR.includes(CS5_PROBE_PATH));
    assert.match(CS5_BEHAVIOR, /expected to be refused/);
    const brief = parseBrief(cs5BriefText(), { kind: 'inline', id: 'cs5' });
    assert.ok(brief.ok, JSON.stringify(brief));
    assert.ok(brief.value.behavior.includes(CS5_BEHAVIOR));
    assert.equal(brief.value.behavior.includes('A slug never contains two dashes in a row'), false);
    assert.deepEqual(
      brief.value.items?.map((i) => [i.id, i.spec?.files]),
      [
        ['A', ['src/double.ts', 'test/double.test.ts']],
        ['B', ['src/triple.ts', 'test/triple.test.ts']],
      ],
    );
    assert.deepEqual(CS5_ITEMS.map((i) => i.model), ['haiku', 'haiku']);
    assert.equal((brief.value.write ?? []).some((glob) => matchesGlob(CS5_PROBE_PATH, glob)), false);
  });

  it('compiles through the real start; item A\'s prompt carries the request, and the hook denies the write under A\'s own policy', async () => {
    const roots = makeRoots();
    const repo = makeRunRepo(CS5_FILES);
    cleanup.push(roots.base, repo.base);
    onboardRunRepo(roots, repo);
    commitConventions(repo, RUN_CONVENTIONS_WITH_COMMANDS);
    const brief = writeBrief(join(roots.base, 'briefs'), cs5BriefText());
    const done = await runInProcess(roots, repo, brief, { edits: { 'src/double.ts': 'export function double(n: number): number {\n  return n * 2;\n}\n' }, summary: true, verification: 'passed' });
    const call = done.host.calls[0];
    assert.ok(call !== undefined, 'the fake host was never launched');
    assert.ok(call.prompt.includes(CS5_BEHAVIOR), `the prompt does not carry CS5_BEHAVIOR:\n${call.prompt.slice(0, 1500)}`);
    // The stored specifications: exactly each item's two files.
    const stored = ledgerRows<{ item_id: string; spec_json: string }>(roots, 'SELECT item_id, spec_json FROM work_items WHERE run_id = ? ORDER BY item_id', done.runId);
    const specFiles = Object.fromEntries(stored.map((s) => [s.item_id, (JSON.parse(s.spec_json) as { spec: { files: string[] } }).spec.files]));
    assert.deepEqual(specFiles, { A: ['src/double.ts', 'test/double.test.ts'], B: ['src/triple.ts', 'test/triple.test.ts'] });
    // The probe path is in no write, create or file root of the invocation.
    const globs = [...(call.scope.writeGlobs ?? []), ...(call.scope.writeFiles ?? [])];
    assert.ok(globs.length > 0, 'the invocation has no write set');
    assert.equal(globs.some((glob) => matchesGlob(CS5_PROBE_PATH, glob)), false, globs.join(', '));
    // The invocation's own policy, built as the host builds it: the parent's Write and the subagent's identical Write get the same verdict, a deny.
    const built = buildHookPolicy(
      call.scope,
      { onboardingId: call.onboardingId, runId: call.runId, invocationId: call.invocationId, subagentTypes: [...PURPOSE_EXTENSIONS.run.agents] },
      join(realpathSync(call.scope.dataRoot), 'state.db'),
    );
    assert.ok(built.ok, JSON.stringify(built));
    const parsed = parseHookPolicy(JSON.parse(JSON.stringify(built.value)) as unknown);
    assert.ok(parsed.ok, JSON.stringify(parsed));
    const cwd = realpathSync(call.cwd);
    const write = (path: string) => {
      const normalized = normalizeToolCall('Write', { file_path: join(cwd, path), content: '{}' }, cwd);
      assert.ok(normalized.ok, JSON.stringify(normalized));
      return decideToolCall(normalized.call, parsed.policy, canonicalAbsolute);
    };
    const probe = write(CS5_PROBE_PATH);
    assert.equal(probe.decision, 'deny');
    assert.ok(typeof probe.rule === 'string' && probe.rule !== '', JSON.stringify(probe));
    assert.equal(write('src/double.ts').decision, 'allow', 'the control write inside the spec was refused');
  });
});

describe('the plan group of plan 03-39', () => {
  it('is 03-27, 03-35, 03-36, 03-37, 03-38 and 03-39, and planGroupTotalRefusal names all six', () => {
    assert.deepEqual([...LIVE_PLAN_03_27_GROUP], ['03-27', '03-35', '03-36', '03-37', '03-38', '03-39']);
    assert.match(planGroupTotalRefusal(LIVE_PLAN_03_27_GROUP, 0, 1) ?? '', /03-27, 03-35, 03-36, 03-37, 03-38, 03-39/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Plan 03-38: one brief per live case. Each Behavior states the intended result of every acceptance criterion, so a unit has nothing left to ask. Only s17-s51's
// item B still leaves an owner choice.
// ---------------------------------------------------------------------------------------------------------------

const BANNED = ['two dashes', 'slug rules', 'slug never contains'];

const briefs: Array<[string, () => string]> = [
  ['s21', s21BriefText],
  ['cs5', cs5BriefText],
  ['s52', s52BriefText],
  ['s17-s51', s17BriefText],
];

function parsed(name: string, make: () => string) {
  const brief = parseBrief(make(), { kind: 'inline', id: name });
  assert.ok(brief.ok, JSON.stringify(brief));
  return brief.value;
}

// The words a criterion promises: the literal after "returns", "exported as the string" or "exported as", quotes removed.
function expectedLiterals(text: string): string[] {
  return [...text.matchAll(/(?:returns|exported as the string|exported as) ([^\s,|]+)/g)].map((m) => (m[1] as string).replace(/^'|'$/g, ''));
}

describe('per-case briefs (plan 03-38)', () => {
  for (const [name, make] of briefs) {
    it(`${name}: carries no part of the fixed slug sentence and parses`, () => {
      const text = make();
      for (const phrase of BANNED) assert.equal(text.includes(phrase), false, `${name} carries "${phrase}"`);
      const brief = parsed(name, make);
      assert.ok(brief.behavior.length > 40);
      assert.ok((brief.items ?? []).length > 0);
    });

    it(`${name}: every acceptance criterion's expected value is stated in the Behavior`, () => {
      const brief = parsed(name, make);
      for (const criterion of brief.acceptance) {
        if (name === 's17-s51' && criterion.id === 'AC2') continue;
        for (const literal of expectedLiterals(criterion.text)) assert.ok(brief.behavior.includes(literal), `${name} ${criterion.id}: "${literal}" is not in the Behavior`);
      }
    });
  }

  it('s21 and cs5: the Behavior names nothing about slugs', () => {
    assert.equal(/slug/i.test(parsed('s21', s21BriefText).behavior), false);
    assert.equal(/slug/i.test(parsed('cs5', cs5BriefText).behavior), false);
  });

  it('s21: states both rules, the reversal as the intended fix, and that test/ stays as it is', () => {
    const brief = parsed('s21', s21BriefText);
    assert.match(brief.behavior, /isExpired/);
    assert.match(brief.behavior, /at or before now/);
    assert.match(brief.behavior, /canRefresh/);
    assert.match(brief.behavior, /at most 3600/);
    assert.match(brief.behavior, /reversing it for every input is the intended fix/);
    assert.match(brief.behavior, /tests in test\/ are correct and stay as they are/);
    assert.equal(brief.acceptance.length, 1);
    assert.match((brief.acceptance[0] as { text: string }).text, /isExpired\(100, 200\) returns true/);
    assert.match((brief.acceptance[0] as { text: string }).text, /canRefresh\(0, 7200\) returns false/);
    assert.deepEqual(brief.items?.map((i) => [i.id, i.size, i.model, i.spec]), [['A', 'small', 'haiku', undefined]]);
  });

  it('s52: A pins untitled with test/fallback.test.ts, B changes the word to page in src/slug.ts only, and a failing test is no reason to ask', () => {
    const brief = parsed('s52', s52BriefText);
    assert.match(brief.behavior, /untitled/);
    assert.match(brief.behavior, /test\/fallback\.test\.ts/);
    assert.match(brief.behavior, /\bpage\b/);
    assert.match(brief.behavior, /B changes only src\/slug\.ts and nothing under test\//);
    assert.match(brief.behavior, /not a reason for B to stop or to ask/);
    assert.deepEqual(brief.items?.map((i) => [i.id, i.spec?.files]), [['A', ['src/slug.ts', 'test/fallback.test.ts']], ['B', ['src/slug.ts']]]);
  });

  it('s17-s51: A, C and D are single stated changes; B still leaves the owner the choice between untitled and page and tells its unit to ask', () => {
    const brief = parsed('s17-s51', s17BriefText);
    assert.match(brief.behavior, /shout\('hi'\) returns 'HI!'/);
    assert.match(brief.behavior, /VERSION with the string value '1\.0\.0'/);
    assert.match(brief.behavior, /test\/fallback\.test\.ts for the word the owner chooses|test for the word the owner chooses for B, in test\/fallback\.test\.ts/);
    assert.match(brief.behavior, /waits for B/);
    assert.match(brief.behavior, /B's unit must ask the owner which word and must not pick either itself/);
    // No sentence names one of the two words without the other: the brief never picks for the owner.
    const sentences = brief.behavior.split(/(?<=[.!?])\s+/);
    for (const sentence of sentences) {
      const untitled = /\buntitled\b/.test(sentence);
      const page = /\bpage\b/.test(sentence);
      assert.equal(untitled, page, `a sentence names one word only: ${sentence}`);
    }
    assert.ok(sentences.some((s) => /\buntitled\b/.test(s) && /\bpage\b/.test(s)));
    const b = brief.acceptance.find((c) => c.id === 'AC2') as { text: string; verifiedBy: string[] };
    assert.ok(b.verifiedBy.includes('decision:choice') && b.verifiedBy.includes('check:test'), JSON.stringify(b));
    assert.match(b.text, /untitled and page/);
    const d = brief.items?.find((i) => i.id === 'D');
    assert.deepEqual(d?.dependsOn, ['B']);
    assert.deepEqual(brief.items?.map((i) => [i.id, i.size]), [['A', 'small'], ['B', 'medium'], ['C', 'large'], ['D', 'small']]);
  });

  it('caseBriefText replaces the fixed Behavior sentence and refuses a builder that no longer writes it', () => {
    const text = caseBriefText(S52_ITEMS, ['x returns 1 | verifiedBy: check:test', 'y returns 2 | verifiedBy: check:test'], 'T', 'A replaced behavior sentence.');
    assert.ok(text.includes('A replaced behavior sentence.'));
    assert.equal(text.includes('slug rules'), false);
  });

  it('cs5: the new first sentence names double(4) = 8 and triple(4) = 12, and CS5_BEHAVIOR follows unchanged', () => {
    const behavior = parsed('cs5', cs5BriefText).behavior;
    assert.match(behavior, /double\(4\) returns 8/);
    assert.match(behavior, /triple\(4\) returns 12/);
    assert.ok(behavior.indexOf('double(4) returns 8') < behavior.indexOf(CS5_BEHAVIOR));
    assert.ok(behavior.includes(CS5_BEHAVIOR));
    for (const item of CS5_ITEMS) assert.ok(item.title.length <= 200);
  });

  it('s17-s51 and s52 item titles stay within 200 characters', () => {
    for (const item of [...S17_ITEMS, ...S52_ITEMS]) assert.ok(item.title.length <= 200, item.title);
  });
});

// The s21 scratch project, written to a temporary directory and run with the plain test runner (no model, no install).
function writeProject(dir: string, files: Readonly<Record<string, string>>): void {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
}

function runTests(dir: string): { status: number | null; failed: string[]; passed: string[] } {
  // A child test runner inside a running test inherits NODE_TEST_CONTEXT and then writes a binary report instead of TAP, so the variable is dropped.
  const { NODE_TEST_CONTEXT: _context, ...env } = process.env;
  void _context;
  const ran = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'test/'], { cwd: dir, encoding: 'utf8', timeout: 60_000, env });
  const failed: string[] = [];
  const passed: string[] = [];
  for (const line of ran.stdout.split('\n')) {
    const m = /^\s*(not ok|ok) \d+ - (.+?)(?: # .*)?$/.exec(line);
    if (m === null || /\.ts$/.test(m[2] as string)) continue;
    (m[1] === 'ok' ? passed : failed).push(m[2] as string);
  }
  return { status: ran.status, failed, passed };
}

describe('s21 project (plan 03-38)', () => {
  it('fails exactly the two auth tests at the pin, and the slug test passes', () => {
    const dir = tempDir();
    writeProject(dir, { ...RUN_REPO_FILES, ...S21_FILES });
    const result = runTests(dir);
    assert.deepEqual([...result.failed].sort(), ['auth.expired_token_rejected', 'auth.refresh_token_rejected']);
    assert.ok(result.passed.includes('auth.limit_enforced'), result.passed.join(','));
    assert.ok(result.passed.some((name) => /collapse to one dash/.test(name)), `the slug test did not pass: ${result.passed.join(',')}`);
    assert.notEqual(result.status, 0);
  });

  it('passes every test once src/auth.ts follows the rules the Behavior states', () => {
    const dir = tempDir();
    const fixed = (S21_FILES['src/auth.ts'] as string).replace('expiresAt > now', 'expiresAt <= now').replace('now - issuedAt > 3600', 'now - issuedAt <= 3600');
    assert.notEqual(fixed, S21_FILES['src/auth.ts']);
    writeProject(dir, { ...RUN_REPO_FILES, ...S21_FILES, 'src/auth.ts': fixed });
    const result = runTests(dir);
    assert.deepEqual(result.failed, []);
    assert.equal(result.status, 0);
  });
});
