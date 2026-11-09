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
import { CS5_BEHAVIOR, CS5_FILES, CS5_ITEMS, CS5_PROBE_PATH, S21_AFTER_UNIT_SCRIPT, S21_FILES, cs5BriefText } from '../helpers/live-phase3-fixtures.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import { RUN_CONVENTIONS_WITH_COMMANDS, commitConventions, ledgerRows, makeRunRepo, onboardRunRepo, runInProcess, writeBrief } from '../helpers/run-fixtures.ts';

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

describe('the plan group of plan 03-37', () => {
  it('is 03-27, 03-35, 03-36 and 03-37, and planGroupTotalRefusal names all four', () => {
    assert.deepEqual([...LIVE_PLAN_03_27_GROUP], ['03-27', '03-35', '03-36', '03-37']);
    assert.match(planGroupTotalRefusal(LIVE_PLAN_03_27_GROUP, 0, 1) ?? '', /03-27, 03-35, 03-36, 03-37/);
  });
});
