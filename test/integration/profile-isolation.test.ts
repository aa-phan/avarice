// AC-6, the profile isolation suite (plan 04-22; SEC-1, S-9, S-37, T-04-59): a second profile's whole workflow reads nothing of the first.
//
// personal-local holds an active record and a ready_for_review run of repository R1 with canary strings in its store, its artifacts, its work root and its
// config; enterprise-acme gets repository R2. Every enterprise-acme command (repo add, onboard with the index and knowledge steps, context, status, inbox,
// start killed in verification, resume, start and resume with the fake host) runs under `sandbox-exec` with the network denied and every read of
// personal-local's data root, work root and profile config denied. macOS offers no unprivileged syscall trace, so a cross-profile read is counted two ways:
//
//   1. a command that fails on the denial, or whose output names a denied path, is a read that was attempted and refused;
//   2. a canary string planted in personal-local's roots that turns up in anything enterprise-acme wrote is a read that succeeded.
//
// AC-6 is 0 on both counts. Controls prove each count can be non-zero: a read of a canary under the same wrapper fails, and the scan of personal-local's own
// roots finds every canary. Scratch repositories and temp directories only; no model is called.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { knownProfileRoots } from '../../src/adapters/fs/profile-registry.ts';
import { NO_NETWORK_PROFILE, SANDBOX_EXEC, TEST_CLI, offlineAvailable } from '../helpers/offline.ts';
import { runCli } from '../helpers/run-cli.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import { writeFakeGraphify } from '../helpers/fake-graphify.ts';
import { RUN_BRIEF, RUN_CONVENTIONS_WITH_COMMANDS, commitConventions, makeRunRepo, writeBrief } from '../helpers/run-fixtures.ts';
import { sleepSync } from '../helpers/fault-run.ts';
import { FIXED_SLUG } from '../helpers/run-fixtures.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const PL = 'personal-local';
const ENT = 'enterprise-acme';
const CLEANUP: string[] = [];
after(() => {
  for (const dir of CLEANUP) rmSync(dir, { recursive: true, force: true });
});

const FIX_RUN = { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' } as const;
const DENIAL = /EPERM|EACCES|Operation not permitted|Permission denied/i;
// Longer than the 200 ms test lease, with margin for a slow machine.
const LEASE_WAIT_MS = 1500;

// `sandbox-exec` with the network denied, every read of `all` denied (a subpath covers the directory itself and everything below it) and the reading of
// the contents of `contents` denied: file data and directory listings, but not the metadata of the directory itself.
//
// The config home is shared by every profile (it holds bindings.json and each profile's own config), so the config denied here is personal-local's profile
// directory. It is denied by contents rather than whole because composition lstats every profile directory it finds and fails closed (exit 70) when the
// lstat is refused (the registry of plan 04-12, D-19; recorded as a finding in the summary of plan 04-22).
function denyRead(all: readonly string[], contents: readonly string[]): readonly string[] {
  const subpaths = (paths: readonly string[]): string => paths.map((p) => `(subpath ${JSON.stringify(p)})`).join(' ');
  return [SANDBOX_EXEC, '-p', `${NO_NETWORK_PROFILE}(deny file-read* ${subpaths(all)})(deny file-read-data ${subpaths(contents)})`];
}

function treeFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(full);
    }
  };
  if (lstatSync(root).isDirectory()) walk(root);
  else out.push(root);
  return out;
}

// Every table of a store as text, so a canary in any column of any table is found.
function dumpStore(dataRoot: string): string {
  const db = new DatabaseSync(join(dataRoot, 'state.db'), { readOnly: true, timeout: 5000 });
  try {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>).map((t) => t.name);
    return tables
      .map((name) => `${name}: ${JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all(), (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value instanceof Uint8Array ? Buffer.from(value).toString('latin1') : value))}`)
      .join('\n');
  } finally {
    db.close();
  }
}

// How many of `canaries` occur in the files under `roots`, in the store dump of `dataRoot` (when it has a store) and in `extra` text.
function canaryHits(canaries: Readonly<Record<string, string>>, roots: readonly string[], dataRoot: string | undefined, extra: readonly string[]): string[] {
  const haystacks: Array<{ where: string; bytes: Buffer }> = [];
  for (const root of roots) for (const file of treeFiles(root)) haystacks.push({ where: file, bytes: readFileSync(file) });
  if (dataRoot !== undefined && existsSync(join(dataRoot, 'state.db'))) haystacks.push({ where: 'store dump', bytes: Buffer.from(dumpStore(dataRoot), 'latin1') });
  extra.forEach((text, i) => haystacks.push({ where: `command output ${i}`, bytes: Buffer.from(text, 'latin1') }));
  const hits: string[] = [];
  for (const [kind, canary] of Object.entries(canaries)) {
    const needle = Buffer.from(canary, 'latin1');
    for (const h of haystacks) if (h.bytes.includes(needle)) hits.push(`${kind} in ${h.where}`);
  }
  return hits;
}

function fingerprint(root: string): string[] {
  return treeFiles(root)
    .sort()
    .map((f) => `${f}:${statSync(f).size}:${statSync(f).mtimeMs}`);
}

interface Recorded {
  label: string;
  argv: readonly string[];
  expected: readonly number[];
  result: CliResult;
}

// A command counts as a cross-profile read when it did not end as documented, failed on a permission error, or printed a denied path.
function crossProfileRead(c: Recorded, denied: readonly string[]): boolean {
  const text = c.result.stderr + c.result.stdout;
  return !c.expected.includes(c.result.code ?? -1) || DENIAL.test(text) || denied.some((p) => text.includes(p));
}

interface World {
  base: string;
  config: string;
  pl: CliRoots;
  ent: CliRoots;
  r1: ScratchRepo;
  r2: ScratchRepo;
  graphify: string;
  canaries: Record<string, string>;
  // Personal-local's data root and work root (read denied outright) and its profile config directory (contents denied).
  denied: string[];
  deniedContents: string[];
}

function newWorld(): World {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-isolation-')));
  CLEANUP.push(base);
  const config = join(base, 'config');
  const mk = (tag: string): CliRoots => ({ base, AVARICE_CONFIG_HOME: config, AVARICE_DATA_ROOT: join(base, `${tag}-data`), AVARICE_WORK_ROOT: join(base, `${tag}-work`) });
  const nonce = randomBytes(8).toString('hex');
  const canaries = {
    'project title': `CANARY-PL-TITLE-${nonce}`,
    'repository file': `CANARY-PL-REPO-${nonce}`,
    'data root file': `CANARY-PL-DATA-${nonce}`,
    'work root file': `CANARY-PL-WORK-${nonce}`,
    'config file': `CANARY-PL-CONFIG-${nonce}`,
  };
  const r1 = makeRunRepo({ 'NOTES.md': `# notes\n${canaries['repository file']}\n` });
  const r2 = makeRunRepo();
  CLEANUP.push(r1.base, r2.base);
  const pl = mk('pl');
  const ent = mk('ent');
  return { base, config, pl, ent, r1, r2, graphify: writeFakeGraphify(join(base, 'fake-graphify'), 'ok'), canaries, denied: [pl.AVARICE_DATA_ROOT, pl.AVARICE_WORK_ROOT], deniedContents: [join(config, 'profiles', PL)] };
}

const hostEnv = (w: World, host: unknown, extra: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  AVARICE_FAKE_HOST: JSON.stringify(host),
  AVARICE_GRAPHIFY_BIN: w.graphify,
  AVARICE_LEASE_TTL_MS: '200',
  ...extra,
});

// personal-local, unsandboxed: R1 bound and onboarded, a run to ready_for_review, and a canary in each of its three roots.
function buildPersonalLocal(w: World): void {
  const add = runCli(['repo', 'add', '--profile', PL, w.r1.path], { roots: w.pl, entry: TEST_CLI, env: hostEnv(w, {}) });
  assert.equal(add.code, 0, add.stderr + add.stdout);
  const onboard = runCli(['onboard', '--policy', 'onboarding', '--profile', PL, w.r1.path], { roots: w.pl, entry: TEST_CLI, env: hostEnv(w, {}) });
  assert.equal(onboard.code, 0, onboard.stderr + onboard.stdout);
  commitConventions(w.r1, RUN_CONVENTIONS_WITH_COMMANDS);
  const brief = writeBrief(join(w.base, 'pl-briefs'), RUN_BRIEF.replace('title: Collapse repeated dashes in slugs', `title: ${w.canaries['project title']}`));
  const started = runCli(['start', '--brief', brief, '--policy', 'routine', '--wait', '--profile', PL], {
    roots: w.pl,
    cwd: w.r1.path,
    entry: TEST_CLI,
    env: hostEnv(w, { run: FIX_RUN }),
    timeoutMs: 300_000,
  });
  assert.equal(started.code, 0, started.stderr + started.stdout);
  assert.match(started.stdout, /ready_for_review/);
  mkdirSync(join(w.pl.AVARICE_DATA_ROOT, 'artifacts'), { recursive: true });
  writeFileSync(join(w.pl.AVARICE_DATA_ROOT, 'artifacts', 'canary.txt'), `${w.canaries['data root file']}\n`);
  mkdirSync(join(w.pl.AVARICE_WORK_ROOT, 'staging-note'), { recursive: true });
  writeFileSync(join(w.pl.AVARICE_WORK_ROOT, 'staging-note', 'canary.txt'), `${w.canaries['work root file']}\n`);
  writeFileSync(join(w.config, 'profiles', PL, 'notes.txt'), `key=${w.canaries['config file']}\n`);
}

describe('AC-6: a second profile runs its whole workflow with the first profile unreadable', { skip: !offlineAvailable() }, () => {
  const w = newWorld();
  const recorded: Recorded[] = [];
  let runId = '';
  let onboardingId = '';

  // An enterprise-acme command under the deny wrapper. `expected` lists the exit codes the command documents for this case.
  const ent = (label: string, argv: readonly string[], expected: readonly number[], options: { cwd?: string; host?: unknown; env?: Record<string, string | undefined>; timeoutMs?: number } = {}): CliResult => {
    const result = runCli(argv, {
      roots: w.ent,
      cwd: options.cwd ?? w.r2.path,
      entry: TEST_CLI,
      wrap: denyRead(w.denied, w.deniedContents),
      env: hostEnv(w, options.host ?? {}, { AVARICE_TEST_OUTER_SANDBOX: '1', ...options.env }),
      timeoutMs: options.timeoutMs ?? 300_000,
    });
    recorded.push({ label, argv, expected, result });
    return result;
  };

  before(() => {
    buildPersonalLocal(w);
  });

  it('control: the wrapper denies a read of a personal-local canary, and the scan finds every canary in personal-local\'s own roots', () => {
    const file = join(w.pl.AVARICE_DATA_ROOT, 'artifacts', 'canary.txt');
    const open = spawnSync('/bin/cat', [file], { encoding: 'utf8' });
    assert.equal(open.stdout.trim(), w.canaries['data root file'], 'readable without the wrapper');
    const [wrapper, ...args] = denyRead(w.denied, w.deniedContents) as [string, ...string[]];
    for (const denied of [file, join(w.pl.AVARICE_WORK_ROOT, 'staging-note', 'canary.txt'), join(w.config, 'profiles', PL, 'notes.txt')]) {
      const blocked = spawnSync(wrapper, [...args, '/bin/cat', denied], { encoding: 'utf8' });
      assert.notEqual(blocked.status, 0, denied);
      assert.match(blocked.stderr, DENIAL);
      assert.equal(blocked.stdout, '');
    }
    const own = canaryHits(w.canaries, [w.pl.AVARICE_DATA_ROOT, w.pl.AVARICE_WORK_ROOT, join(w.config, 'profiles', PL)], w.pl.AVARICE_DATA_ROOT, []);
    for (const kind of Object.keys(w.canaries)) assert.ok(own.some((h) => h.startsWith(`${kind} in `)), `the scan finds the ${kind} canary in personal-local's roots`);
    assert.ok(own.some((h) => h === 'project title in store dump'), 'the project title canary is in personal-local\'s store');
  });

  it('control: the registry finds personal-local\'s roots, which the environment moved off the default parents (D-19)', () => {
    const known = knownProfileRoots(w.config, ENT, { home: join(w.base, 'home'), ownDataRoot: w.ent.AVARICE_DATA_ROOT, ownWorkRoot: w.ent.AVARICE_WORK_ROOT });
    assert.ok(known.ok, JSON.stringify(known));
    assert.ok(known.value.includes(w.pl.AVARICE_DATA_ROOT), 'the moved data root');
    assert.ok(known.value.includes(w.pl.AVARICE_WORK_ROOT), 'the moved work root');
    assert.ok(known.value.includes(w.config), 'the config home');
  });

  it('control: the count is not blind, a command that opens personal-local\'s store under the same wrapper is counted', () => {
    const result = runCli(['status', '--json'], { roots: w.pl, cwd: w.r1.path, entry: TEST_CLI, wrap: denyRead(w.denied, w.deniedContents), env: hostEnv(w, {}) });
    const probe: Recorded = { label: 'personal-local status under the wrapper', argv: ['status', '--json'], expected: [0], result };
    assert.notEqual(result.code, 0, result.stdout);
    assert.ok(crossProfileRead(probe, [...w.denied, ...w.deniedContents]), 'the classifier flags it');
    assert.equal(result.stdout.includes(w.canaries['project title'] as string), false, 'and nothing of the store reaches the output');
  });

  it('repo add, onboard (with the index and knowledge steps), context, status and inbox run to their documented codes under the deny sandbox', () => {
    const added = ent('repo add', ['repo', 'add', '--profile', ENT, w.r2.path], [0]);
    assert.equal(added.code, 0, added.stderr + added.stdout);
    const onboarded = ent('onboard', ['onboard', '--policy', 'onboarding', '--profile', ENT, w.r2.path], [0]);
    assert.equal(onboarded.code, 0, onboarded.stderr + onboarded.stdout);
    onboardingId = /onboarding (onb_[0-9A-Z]{26}): active/.exec(onboarded.stdout)?.[1] ?? '';
    assert.notEqual(onboardingId, '', onboarded.stdout);
    const context = ent('context', ['context', 'slugify', '--json'], [0]);
    assert.equal(context.code, 0, context.stderr + context.stdout);
    const status = ent('status', ['status', '--json'], [0]);
    assert.equal(status.code, 0, status.stderr);
    const entries = JSON.parse(status.stdout) as Array<{ state: string; indexes: { graph?: unknown } }>;
    assert.equal(entries.length, 1, 'only the enterprise-acme repository is listed');
    assert.equal(entries[0]?.state, 'active');
    assert.ok(entries[0]?.indexes.graph !== undefined, 'the index step built the graph');
    const inbox = ent('inbox', ['inbox', '--json'], [0]);
    assert.equal(inbox.code, 0, inbox.stderr);
    assert.deepEqual(JSON.parse(inbox.stdout), { decisions: [], reviews: [] }, 'personal-local\'s ready_for_review run is not in the inbox of enterprise-acme');
    const resumedOnboarding = ent('resume onboarding', ['resume', onboardingId], [0]);
    assert.equal(resumedOnboarding.code, 0, resumedOnboarding.stderr + resumedOnboarding.stdout);
  });

  it('start with the fake host (killed in verification), status, and resume of the interrupted run run under the deny sandbox', () => {
    commitConventions(w.r2, RUN_CONVENTIONS_WITH_COMMANDS);
    const brief = writeBrief(join(w.base, 'ent-briefs'));
    const started = ent('start (killed)', ['start', '--brief', brief, '--policy', 'routine', '--wait', '--profile', ENT], [3], { host: { run: FIX_RUN }, env: { AVARICE_FAULT: 'mid-verify' } });
    assert.equal(started.code, 3, started.stderr + started.stdout);
    runId = /^run (run_[0-9A-Z]{26}): interrupted/m.exec(started.stdout)?.[1] ?? '';
    assert.notEqual(runId, '', started.stdout);
    sleepSync(LEASE_WAIT_MS);
    const paused = ent('status (paused run)', ['status'], [0]);
    assert.equal(paused.code, 0, paused.stderr);
    assert.match(paused.stdout, new RegExp(`^run ${runId}: paused`, 'm'));
    const resumed = ent('resume run', ['resume', runId, '--wait'], [0], { host: { run: FIX_RUN } });
    assert.equal(resumed.code, 0, resumed.stderr + resumed.stdout);
    assert.match(resumed.stdout, /ready_for_review/);
    const again = ent('resume run (stopped)', ['resume', runId], [0]);
    assert.equal(again.code, 0, again.stderr + again.stdout);
    const inbox = ent('inbox (review)', ['inbox', '--json'], [0]);
    assert.equal(inbox.code, 0, inbox.stderr);
    const reviews = (JSON.parse(inbox.stdout) as { reviews: Array<{ runId: string }> }).reviews;
    assert.deepEqual(reviews.map((r) => r.runId), [runId], 'the inbox lists the one enterprise-acme run for review, not personal-local\'s');
  });

  it('S-9: status naming personal-local inside the enterprise-acme repository exits 3 and neither store was touched', () => {
    const plBefore = fingerprint(w.pl.AVARICE_DATA_ROOT);
    const entBefore = fingerprint(w.ent.AVARICE_DATA_ROOT);
    const refused = ent('status --profile personal-local (S-9)', ['status', '--json', '--profile', PL], [3]);
    assert.equal(refused.code, 3, refused.stderr);
    assert.match(refused.stderr, /repository bound to enterprise-acme/);
    assert.deepEqual(fingerprint(w.pl.AVARICE_DATA_ROOT), plBefore, 'personal-local\'s store is as it was');
    assert.deepEqual(fingerprint(w.ent.AVARICE_DATA_ROOT), entBefore, 'enterprise-acme\'s store is as it was');
  });

  it('cross-profile reads: no command failed on a denied personal-local path and none named one', () => {
    assert.ok(recorded.length >= 8, `${recorded.length} enterprise-acme commands ran under the deny sandbox`);
    const failures = recorded.filter((c) => crossProfileRead(c, [...w.denied, ...w.deniedContents]));
    console.log(`cross-profile reads: ${failures.length} (enterprise-acme commands that failed on, or named, a denied personal-local path; ${recorded.length} commands ran)`);
    assert.deepEqual(
      failures.map((c) => `${c.label}: exit ${String(c.result.code)}`),
      [],
    );
  });

  it('cross-profile reads: no personal-local canary is in anything enterprise-acme wrote or printed', () => {
    const output = recorded.flatMap((c) => [c.result.stdout, c.result.stderr]);
    const hits = canaryHits(w.canaries, [w.ent.AVARICE_DATA_ROOT, w.ent.AVARICE_WORK_ROOT, join(w.config, 'profiles', ENT), join(w.config, 'bindings.json')], w.ent.AVARICE_DATA_ROOT, output);
    console.log(`cross-profile reads: ${hits.length} (personal-local canaries in what enterprise-acme wrote; ${Object.keys(w.canaries).length} canaries, ${treeFiles(w.ent.AVARICE_DATA_ROOT).length + treeFiles(w.ent.AVARICE_WORK_ROOT).length} files and the store scanned)`);
    assert.deepEqual(hits, []);
  });
});

// The default parents (`<home>/.local/share/avarice/<profile>`, `<home>/.local/share/avarice-work/<profile>` and `<home>/.config/avarice/profiles/<profile>`),
// with no AVARICE_* root override: the layout of a user who never moved a root. The commands here need no gsd-core, so a temp HOME is enough.
describe('AC-6 on the default parents: enterprise-acme commands under a deny of personal-local\'s default roots', { skip: !offlineAvailable() }, () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-isolation-home-')));
  CLEANUP.push(home);
  const repo = makeRunRepo();
  CLEANUP.push(repo.base);
  const canary = `CANARY-PL-DEFAULT-${randomBytes(8).toString('hex')}`;
  const dataOf = (profile: string): string => join(home, '.local', 'share', 'avarice', profile);
  const workOf = (profile: string): string => join(home, '.local', 'share', 'avarice-work', profile);
  const configOf = (profile: string): string => join(home, '.config', 'avarice', 'profiles', profile);
  const env = (extra: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
    AVARICE_CONFIG_HOME: undefined,
    AVARICE_DATA_ROOT: undefined,
    AVARICE_WORK_ROOT: undefined,
    AVARICE_PROFILE: undefined,
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    AVARICE_FAKE_HOST: '{}',
    ...extra,
  });
  const recorded: Recorded[] = [];

  it('commands run to their documented codes with personal-local\'s default roots unreadable, and no canary reaches enterprise-acme', () => {
    const init = runCli(['init', '--profile', PL], { entry: TEST_CLI, env: env() });
    assert.equal(init.code, 0, init.stderr);
    writeFileSync(join(dataOf(PL), 'canary.txt'), `${canary}\n`);
    mkdirSync(workOf(PL), { recursive: true });
    writeFileSync(join(workOf(PL), 'canary.txt'), `${canary}\n`);
    writeFileSync(join(configOf(PL), 'notes.txt'), `key=${canary}\n`);
    const denied = [dataOf(PL), workOf(PL)];
    const deniedContents = [configOf(PL)];
    const wrap = denyRead(denied, deniedContents);
    const cases: Array<[string, string[], number[], string?]> = [
      ['init', ['init', '--profile', ENT], [0]],
      ['repo add', ['repo', 'add', '--profile', ENT, repo.path], [0]],
      ['status', ['status', '--json'], [0], repo.path],
      ['inbox', ['inbox', '--json'], [0], repo.path],
      ['status --profile personal-local (S-9)', ['status', '--json', '--profile', PL], [3], repo.path],
    ];
    for (const [label, argv, expected, cwd] of cases) {
      const result = runCli(argv, { entry: TEST_CLI, wrap, env: env({ AVARICE_TEST_OUTER_SANDBOX: '1' }), ...(cwd !== undefined ? { cwd } : {}) });
      recorded.push({ label, argv, expected, result });
    }
    const failures = recorded.filter((c) => crossProfileRead(c, [...denied, ...deniedContents]));
    const hits = canaryHits({ canary }, [dataOf(ENT), workOf(ENT), configOf(ENT), join(home, '.config', 'avarice', 'bindings.json')], dataOf(ENT), recorded.flatMap((c) => [c.result.stdout, c.result.stderr]));
    console.log(`cross-profile reads: ${failures.length} (default parents: commands that failed on, or named, a denied personal-local path; ${recorded.length} commands ran)`);
    console.log(`cross-profile reads: ${hits.length} (default parents: personal-local canaries in what enterprise-acme wrote)`);
    assert.deepEqual(failures.map((c) => `${c.label}: exit ${String(c.result.code)} ${c.result.stderr}`), []);
    assert.deepEqual(hits, []);
    assert.equal(existsSync(join(dataOf(ENT), 'state.db')), true, 'enterprise-acme\'s store exists in its own default root');
  });
});
