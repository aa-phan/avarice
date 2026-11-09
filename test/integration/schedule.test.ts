// `avarice schedule install` and `schedule remove` (plan 03-23; D-23, AUT-6; T-03-44, T-03-45, T-03-46). The plist template is linted with the real
// plutil. The commands run in this process through main() on a stream that claims to be a terminal, with a temporary agents directory and a fake
// launchctl (test/helpers/fake-launchctl.mjs), so no test registers anything with the real launchd; the one gated real round trip is the last block.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { main } from '../../src/cli/main.ts';
import type { ProcessEntry } from '../../src/adapters/proc/ancestry.ts';
import { DIGEST_LABEL_PREFIX, LaunchdScheduler, PLIST_MARKER, renderDigestPlist } from '../../src/adapters/schedule/launchd.ts';
import type { DigestPlistInput } from '../../src/adapters/schedule/launchd.ts';
import { configPathFor } from '../../src/adapters/fs/profile-paths.ts';
import { ok } from '../../src/domain/result.ts';
import type { Result } from '../../src/domain/result.ts';
import { REPO_ROOT, makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { profileEnv } from '../helpers/run-fixtures.ts';
import { fakeTerminal } from '../helpers/shell-streams.ts';

const FAKE_LAUNCHCTL = join(REPO_ROOT, 'test', 'helpers', 'fake-launchctl.mjs');
const PLUTIL = '/usr/bin/plutil';
const UID = process.getuid?.() ?? 0;
const LABEL = `${DIGEST_LABEL_PREFIX}personal-local`;
const ENTRY = join(REPO_ROOT, 'bin', 'avarice.ts');

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const entry = (pid: number, ppid: number, command: string): ProcessEntry => ({ pid, ppid, command });
const CALM_CHAIN = (): Result<ProcessEntry[]> => ok([entry(300, 200, 'node avarice.ts schedule'), entry(200, 100, '-zsh'), entry(100, 1, 'login'), entry(1, 0, '/sbin/launchd')]);
const INSIDE_A_RUN = (): Result<ProcessEntry[]> => ok([entry(300, 200, 'node avarice.ts schedule'), entry(200, 100, 'node avarice.ts supervise run_1'), entry(100, 1, '/sbin/launchd')]);

const plistInput = (extra: Partial<DigestPlistInput> = {}): DigestPlistInput => ({
  label: LABEL,
  nodePath: process.execPath,
  entryPath: ENTRY,
  times: ['12:30', '17:30'],
  env: { AVARICE_DATA_ROOT: '/tmp/avarice-data' },
  logPath: '/tmp/avarice-data/logs/digest.log',
  ...extra,
});

function makeTemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

// The plist as launchd's own property-list tool reads it.
function plistJson(path: string): Record<string, unknown> {
  return JSON.parse(execFileSync(PLUTIL, ['-convert', 'json', '-o', '-', path], { encoding: 'utf8' })) as Record<string, unknown>;
}

describe('renderDigestPlist (T-03-44)', () => {
  function rendered(extra: Partial<DigestPlistInput> = {}): string {
    const result = renderDigestPlist(plistInput(extra));
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error));
    return result.value;
  }
  function lintAndRead(text: string): Record<string, unknown> {
    const dir = makeTemp('avarice-plist-');
    const path = join(dir, 'a.plist');
    writeFileSync(path, text);
    execFileSync(PLUTIL, ['-lint', path], { encoding: 'utf8' });
    return plistJson(path);
  }

  it('is a plist that plutil -lint accepts, with two StartCalendarInterval dictionaries holding integer Hour and Minute', () => {
    const text = rendered();
    const json = lintAndRead(text);
    assert.equal(json['Label'], LABEL);
    assert.deepEqual(json['StartCalendarInterval'], [
      { Hour: 12, Minute: 30 },
      { Hour: 17, Minute: 30 },
    ]);
    assert.match(text, /<key>Hour<\/key><integer>12<\/integer>/);
    assert.deepEqual(json['ProgramArguments'], [process.execPath, ENTRY, 'digest']);
    assert.deepEqual(json['EnvironmentVariables'], { AVARICE_DATA_ROOT: '/tmp/avarice-data' });
    assert.equal(json['StandardOutPath'], '/tmp/avarice-data/logs/digest.log');
    assert.equal(json['StandardErrorPath'], '/tmp/avarice-data/logs/digest.log');
  });

  it('carries the marker comment on a line of its own', () => {
    assert.ok(rendered().split('\n').includes(PLIST_MARKER));
  });

  it('puts the node flags before the entry, and only the one flag a bin shebang uses', () => {
    const json = lintAndRead(rendered({ nodeArgs: ['--disable-warning=ExperimentalWarning'] }));
    assert.deepEqual(json['ProgramArguments'], [process.execPath, '--disable-warning=ExperimentalWarning', ENTRY, 'digest']);
    assert.ok(!renderDigestPlist(plistInput({ nodeArgs: ['--require=/tmp/x.js'] })).ok);
    assert.ok(!renderDigestPlist(plistInput({ nodeArgs: ['--inspect'] })).ok);
  });

  it('refuses a time that is not HH:MM digits, and an empty or oversized list', () => {
    for (const time of ['9:30', '24:00', '12:60', '12:30; rm -rf ~', ' 12:30', '12:30\n', '1230', '12:3', '<12:30', '']) {
      const result = renderDigestPlist(plistInput({ times: [time] }));
      assert.ok(!result.ok, `${JSON.stringify(time)} must be refused`);
      assert.equal(result.error.kind, 'invalid');
    }
    assert.ok(!renderDigestPlist(plistInput({ times: [] })).ok);
    assert.ok(!renderDigestPlist(plistInput({ times: ['00:01', '00:02', '00:03', '00:04', '00:05', '00:06', '00:07'] })).ok);
  });

  it('refuses a relative path in the node, the entry, the log and the environment', () => {
    assert.ok(!renderDigestPlist(plistInput({ nodePath: 'node' })).ok);
    assert.ok(!renderDigestPlist(plistInput({ entryPath: 'bin/avarice.ts' })).ok);
    assert.ok(!renderDigestPlist(plistInput({ logPath: 'logs/digest.log' })).ok);
    assert.ok(!renderDigestPlist(plistInput({ env: { AVARICE_DATA_ROOT: 'data' } })).ok);
  });

  it('refuses a label outside a-z, 0-9, dot and dash, or without the digest prefix, and an environment name that is not one of the three roots', () => {
    for (const label of ['IO.avarice.digest.x', `${DIGEST_LABEL_PREFIX}a b`, `${DIGEST_LABEL_PREFIX}a/b`, `${DIGEST_LABEL_PREFIX}</string>`, `${DIGEST_LABEL_PREFIX}../x`, 'com.example.other', DIGEST_LABEL_PREFIX]) {
      assert.ok(!renderDigestPlist(plistInput({ label })).ok, `${label} must be refused`);
    }
    assert.ok(!renderDigestPlist(plistInput({ env: { PATH: '/usr/bin' } })).ok);
    assert.ok(!renderDigestPlist(plistInput({ env: { DYLD_INSERT_LIBRARIES: '/tmp/x.dylib' } })).ok);
  });

  it('escapes markup in a value even after validation: a path with & < > and quotes round-trips through plutil', () => {
    const odd = '/tmp/a&b<c>"d\'e';
    const json = lintAndRead(rendered({ logPath: odd, entryPath: `/tmp/${'x'}</string><string>/bin/sh` }));
    assert.equal(json['StandardOutPath'], odd);
    assert.deepEqual(json['ProgramArguments'], [process.execPath, '/tmp/x</string><string>/bin/sh', 'digest']);
  });

  it('refuses a control character in a path', () => {
    assert.ok(!renderDigestPlist(plistInput({ logPath: '/tmp/a\nb' })).ok);
    assert.ok(!renderDigestPlist(plistInput({ entryPath: '/tmp/a\u0000b' })).ok);
  });
});

interface Bench {
  roots: CliRoots;
  agents: string;
  log: string;
  scheduler: { agentsDir: string; launchctl: string; plutil: string; uid: number; nodePath: string; entryPath: string };
}

function bench(config: Record<string, unknown> = {}): Bench {
  const roots = makeRoots();
  const dir = makeTemp('avarice-schedule-');
  cleanup.push(roots.base);
  chmodSync(FAKE_LAUNCHCTL, 0o755);
  const agents = join(dir, 'LaunchAgents');
  mkdirSync(agents);
  const path = configPathFor(roots.AVARICE_CONFIG_HOME, 'personal-local');
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify({ schema: 1, profile: 'personal-local', dataRoot: roots.AVARICE_DATA_ROOT, workRoot: roots.AVARICE_WORK_ROOT, ...config }, null, 2)}\n`, { mode: 0o600 });
  return { roots, agents, log: join(dir, 'launchctl.log'), scheduler: { agentsDir: agents, launchctl: FAKE_LAUNCHCTL, plutil: PLUTIL, uid: UID, nodePath: process.execPath, entryPath: ENTRY } };
}

interface Ran {
  code: number;
  out: string;
  err: string;
}

interface ScheduleOptions {
  stdinIsTty?: boolean;
  stdoutIsTty?: boolean;
  env?: NodeJS.ProcessEnv;
  ancestry?: () => Result<ProcessEntry[]>;
  launchctlEnv?: Record<string, string>;
  scheduler?: Partial<Bench['scheduler']>;
}

async function schedule(b: Bench, argv: readonly string[], options: ScheduleOptions = {}): Promise<Ran> {
  const term = fakeTerminal({ inputIsTty: options.stdinIsTty ?? true, outputIsTty: options.stdoutIsTty ?? true });
  const out: string[] = [];
  const err: string[] = [];
  const saved: Record<string, string | undefined> = {};
  const launchEnv = { FAKE_LAUNCHCTL_LOG: b.log, ...options.launchctlEnv };
  for (const [key, value] of Object.entries(launchEnv)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    const code = await main(['schedule', ...argv], {
      env: { ...profileEnv(b.roots), ...options.env },
      io: { out: (t) => void out.push(t), err: (t) => void err.push(t) },
      stdin: term.stdin,
      stdout: term.stdout,
      ancestry: options.ancestry ?? CALM_CHAIN,
      scheduler: { ...b.scheduler, ...options.scheduler },
    } as Parameters<typeof main>[1]);
    return { code, out: out.join(''), err: err.join('') };
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const calls = (b: Bench): string[][] => (existsSync(b.log) ? readFileSync(b.log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[]) : []);
const plistPath = (b: Bench): string => join(b.agents, `${LABEL}.plist`);

describe('schedule install (D-23; T-03-44, T-03-45)', () => {
  it('writes the agent mode 0644 from the profile digest times, lints it, bootstraps it into the gui domain and prints the label and the times', async () => {
    const b = bench({ notify: { digestTimes: ['08:15', '16:45'] } });
    const ran = await schedule(b, ['install']);
    assert.equal(ran.code, 0, ran.err + ran.out);
    assert.match(ran.out, new RegExp(`${LABEL.replaceAll('.', '\\.')}`));
    assert.match(ran.out, /08:15, 16:45/);
    assert.equal(lstatSync(plistPath(b)).mode & 0o777, 0o644);
    assert.deepEqual(readdirSync(b.agents), [`${LABEL}.plist`], 'no temporary file is left behind');
    assert.deepEqual(calls(b), [['bootstrap', `gui/${UID}`, plistPath(b)]]);
    const text = readFileSync(plistPath(b), 'utf8');
    assert.ok(text.split('\n').includes(PLIST_MARKER));
    const json = plistJson(plistPath(b));
    assert.deepEqual(json['StartCalendarInterval'], [
      { Hour: 8, Minute: 15 },
      { Hour: 16, Minute: 45 },
    ]);
    assert.deepEqual(json['ProgramArguments'], [process.execPath, ENTRY, 'digest']);
    assert.deepEqual(json['EnvironmentVariables'], { AVARICE_CONFIG_HOME: b.roots.AVARICE_CONFIG_HOME, AVARICE_DATA_ROOT: b.roots.AVARICE_DATA_ROOT, AVARICE_WORK_ROOT: b.roots.AVARICE_WORK_ROOT });
    const logPath = join(b.roots.AVARICE_DATA_ROOT, 'logs', 'digest.log');
    assert.equal(json['StandardOutPath'], logPath);
    assert.equal(json['StandardErrorPath'], logPath);
    assert.ok(lstatSync(dirname(logPath)).isDirectory(), 'the log directory exists for launchd to write into');
  });

  it('uses the default digest times when the profile sets none', async () => {
    const b = bench();
    const ran = await schedule(b, ['install']);
    assert.equal(ran.code, 0, ran.err);
    assert.match(ran.out, /12:30, 17:30/);
  });

  it('replaces the agent idempotently: the second install boots the old one out, bootstraps the new one and leaves one file', async () => {
    const b = bench();
    assert.equal((await schedule(b, ['install'])).code, 0);
    const again = await schedule(b, ['install']);
    assert.equal(again.code, 0, again.err);
    assert.deepEqual(calls(b), [
      ['bootstrap', `gui/${UID}`, plistPath(b)],
      ['bootout', `gui/${UID}/${LABEL}`],
      ['bootstrap', `gui/${UID}`, plistPath(b)],
    ]);
    assert.deepEqual(readdirSync(b.agents), [`${LABEL}.plist`]);
  });

  it('refuses a symlinked agents directory, a plist path that is a symlink and a plist without the marker, and writes and loads nothing', async () => {
    const symlinked = bench();
    const target = makeTemp('avarice-agents-target-');
    const link = join(makeTemp('avarice-agents-link-'), 'LaunchAgents');
    symlinkSync(target, link);
    const viaLink = await schedule(symlinked, ['install'], { scheduler: { agentsDir: link } });
    assert.equal(viaLink.code, 3, viaLink.err);
    assert.match(viaLink.err, /symbolic link/);
    assert.deepEqual(readdirSync(target), []);
    assert.deepEqual(calls(symlinked), []);

    const planted = bench();
    const elsewhere = join(makeTemp('avarice-plist-target-'), 'victim.plist');
    writeFileSync(elsewhere, 'precious');
    symlinkSync(elsewhere, plistPath(planted));
    const viaPlist = await schedule(planted, ['install']);
    assert.equal(viaPlist.code, 3, viaPlist.err);
    assert.equal(readFileSync(elsewhere, 'utf8'), 'precious');
    assert.deepEqual(calls(planted), []);

    const foreign = bench();
    writeFileSync(plistPath(foreign), '<plist>someone else</plist>\n');
    const overForeign = await schedule(foreign, ['install']);
    assert.equal(overForeign.code, 3, overForeign.err);
    assert.match(overForeign.err, /marker/);
    assert.equal(readFileSync(plistPath(foreign), 'utf8'), '<plist>someone else</plist>\n');
    assert.deepEqual(readdirSync(foreign.agents), [`${LABEL}.plist`]);
    assert.deepEqual(calls(foreign), []);
  });

  it('exits 64 and writes nothing when the profile has no digest time', async () => {
    const b = bench({ notify: { digestTimes: [] } });
    const ran = await schedule(b, ['install']);
    assert.equal(ran.code, 64, ran.err);
    assert.match(ran.err, /digestTimes/);
    assert.deepEqual(readdirSync(b.agents), []);
    assert.deepEqual(calls(b), []);
  });

  it('removes a new file again when launchctl refuses to bootstrap it, and says so (exit 70)', async () => {
    const b = bench();
    const ran = await schedule(b, ['install'], { launchctlEnv: { FAKE_LAUNCHCTL_EXIT: '5' } });
    assert.equal(ran.code, 70, ran.err);
    assert.match(ran.err, /bootstrap/);
    assert.deepEqual(readdirSync(b.agents), []);
  });

  it('writes nothing when plutil rejects the plist (exit 70)', async () => {
    const b = bench();
    const ran = await schedule(b, ['install'], { scheduler: { plutil: '/usr/bin/false' } });
    assert.equal(ran.code, 70, ran.err);
    assert.match(ran.err, /lint/);
    assert.deepEqual(readdirSync(b.agents), []);
    assert.deepEqual(calls(b), []);
  });

  it('refuses a node or entry that does not exist, and writes nothing', async () => {
    const b = bench();
    const ran = await schedule(b, ['install'], { scheduler: { entryPath: '/nonexistent/avarice.ts' } });
    assert.equal(ran.code, 64, ran.err);
    assert.deepEqual(readdirSync(b.agents), []);
    assert.deepEqual(calls(b), []);
  });
});

describe('schedule remove (D-23; T-03-45)', () => {
  it('boots the agent out of the gui domain and deletes the file; a second remove exits 0 and says not installed', async () => {
    const b = bench();
    assert.equal((await schedule(b, ['install'])).code, 0);
    const removed = await schedule(b, ['remove']);
    assert.equal(removed.code, 0, removed.err);
    assert.deepEqual(calls(b).slice(1), [['bootout', `gui/${UID}/${LABEL}`]]);
    assert.equal(existsSync(plistPath(b)), false);
    const again = await schedule(b, ['remove']);
    assert.equal(again.code, 0, again.err);
    assert.match(again.out, /not installed/);
    assert.equal(calls(b).length, 2, 'a missing agent is not booted out again');
  });

  it('deletes the file even when the agent was no longer loaded (launchctl bootout fails with a not-loaded code)', async () => {
    const b = bench();
    assert.equal((await schedule(b, ['install'])).code, 0);
    const removed = await schedule(b, ['remove'], { launchctlEnv: { FAKE_LAUNCHCTL_EXIT_BOOTOUT: '113' } });
    assert.equal(removed.code, 0, removed.err);
    assert.equal(existsSync(plistPath(b)), false);
  });

  it('keeps the file and exits 70 when launchctl bootout fails for another reason', async () => {
    const b = bench();
    assert.equal((await schedule(b, ['install'])).code, 0);
    const removed = await schedule(b, ['remove'], { launchctlEnv: { FAKE_LAUNCHCTL_EXIT_BOOTOUT: '1' } });
    assert.equal(removed.code, 70, removed.err);
    assert.equal(existsSync(plistPath(b)), true);
  });

  it('refuses a file without the marker and a symlinked plist, deleting and unloading nothing', async () => {
    const foreign = bench();
    writeFileSync(plistPath(foreign), '<plist>someone else</plist>\n');
    const refused = await schedule(foreign, ['remove']);
    assert.equal(refused.code, 3, refused.err);
    assert.equal(readFileSync(plistPath(foreign), 'utf8'), '<plist>someone else</plist>\n');
    assert.deepEqual(calls(foreign), []);

    const linked = bench();
    const elsewhere = join(makeTemp('avarice-remove-target-'), 'victim.plist');
    writeFileSync(elsewhere, `${PLIST_MARKER}\n`);
    symlinkSync(elsewhere, plistPath(linked));
    const viaLink = await schedule(linked, ['remove']);
    assert.equal(viaLink.code, 3, viaLink.err);
    assert.equal(existsSync(elsewhere), true);
    assert.deepEqual(calls(linked), []);
  });
});

describe('schedule refuses outside a person at a terminal (T-03-46, CS-11)', () => {
  const cases: Array<{ name: string; options: ScheduleOptions; message: RegExp }> = [
    { name: 'inside a run', options: { env: { AVARICE_RUN: 'run_1' } }, message: /AVARICE_RUN/ },
    { name: 'without a terminal on standard input', options: { stdinIsTty: false }, message: /interactive terminal/ },
    { name: 'without a terminal on standard output', options: { stdoutIsTty: false }, message: /interactive terminal/ },
    { name: "from inside a run's process tree", options: { ancestry: INSIDE_A_RUN }, message: /process tree/ },
  ];
  for (const verb of ['install', 'remove']) {
    for (const c of cases) {
      it(`${verb} exits 64 ${c.name} and writes nothing: no data root, no file, no launchctl call`, async () => {
        const b = bench();
        rmSync(b.roots.AVARICE_DATA_ROOT, { recursive: true, force: true });
        const ran = await schedule(b, [verb], c.options);
        assert.equal(ran.code, 64, ran.err);
        assert.match(ran.err, c.message);
        assert.deepEqual(readdirSync(b.agents), []);
        assert.deepEqual(calls(b), []);
        assert.equal(existsSync(b.roots.AVARICE_DATA_ROOT), false, 'the profile was never resolved');
      });
    }
  }

  it('takes one verb, install or remove, and nothing else', async () => {
    const b = bench();
    for (const argv of [[], ['status'], ['install', 'now'], ['remove', '--all']]) {
      const ran = await schedule(b, argv);
      assert.equal(ran.code, 64, `${JSON.stringify(argv)}: ${ran.err}`);
      assert.match(ran.err, /usage: avarice schedule/);
    }
    assert.deepEqual(readdirSync(b.agents), []);
  });
});

describe('LaunchdScheduler (T-03-45)', () => {
  it('writes through a temporary name and a rename: an agents directory that is not writable leaves nothing and reports an internal error', () => {
    const dir = makeTemp('avarice-readonly-');
    const agents = join(dir, 'LaunchAgents');
    mkdirSync(agents, { mode: 0o500 });
    const scheduler = new LaunchdScheduler({ agentsDir: agents, launchctl: FAKE_LAUNCHCTL, plutil: PLUTIL, uid: UID });
    try {
      const result = scheduler.install(plistInput({ logPath: join(dir, 'logs', 'digest.log') }));
      assert.ok(!result.ok);
      assert.equal(result.error.kind, 'internal');
    } finally {
      chmodSync(agents, 0o700);
    }
    assert.deepEqual(readdirSync(agents), []);
  });

  it('refuses to remove a label that is not a digest label', () => {
    const dir = makeTemp('avarice-label-');
    const scheduler = new LaunchdScheduler({ agentsDir: dir, launchctl: FAKE_LAUNCHCTL, plutil: PLUTIL, uid: UID });
    for (const label of ['com.apple.something', `${DIGEST_LABEL_PREFIX}../escape`, `${DIGEST_LABEL_PREFIX}A`]) {
      const result = scheduler.remove(label);
      assert.ok(!result.ok, label);
      assert.equal(result.error.kind, 'invalid');
    }
  });
});
