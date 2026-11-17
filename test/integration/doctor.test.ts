// `avarice doctor` (plan 04-25; OPS-1, OPS-6, D-20, S-1, S-4, S-38, S-49). Doctor diagnoses the installation offline and read-only on its own composition, so it reports the
// problems the normal composition refuses to start on: a GSD outside the adapter range, a store written by a newer AVARICE, an absent host. Every profile, repository,
// gsd-core, `claude` and configuration directory here is a temp directory; no model is called and the owner's real profile is never read (HOME is a temp directory too).
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { findSecrets } from '../../src/domain/secret-patterns.ts';
import { disposeDoctorFixtures, doctor, doctorFixture, fakeGsd, initStore, reportOf, statePath, temp, writeProfileConfig } from '../helpers/doctor-fixtures.ts';
import type { DoctorFixture } from '../helpers/doctor-fixtures.ts';
import { offlineAvailable, runOffline } from '../helpers/offline.ts';
import { PRODUCTION_ENTRY } from '../helpers/run-cli.ts';

after(disposeDoctorFixtures);

const digestOfFile = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

describe('tracer: `avarice doctor --json` reports every section offline from its own read-only composition, even with a broken GSD and a newer store (OPS-1)', () => {
  it('prints profile, runtime, store, host, gsd, graphify, adapters, runs and findings, and exits 0 when nothing is an error', () => {
    const f = doctorFixture();
    initStore(f);
    const r = doctor(f, ['--json']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const rep = reportOf(r);
    assert.deepEqual(Object.keys(rep), ['profile', 'runtime', 'store', 'host', 'gsd', 'graphify', 'adapters', 'runs', 'records', 'findings']);

    assert.equal(rep.profile.name, 'personal-local');
    assert.equal(rep.profile.class, 'personal');
    assert.equal(rep.profile.roots?.dataRoot, f.roots.AVARICE_DATA_ROOT);
    assert.equal(rep.profile.local, true);

    assert.equal(rep.runtime.node.version, process.versions.node);
    assert.equal(rep.runtime.node.engines, '>=22.22.3');
    assert.equal(rep.runtime.node.ok, true);
    assert.match(rep.runtime.sqlite.version ?? '', /^3\.\d+\.\d+$/);

    assert.equal(rep.store.state, 'ok');
    assert.equal(rep.store.schema, 4);
    assert.equal(rep.store.journalMode, 'wal');
    assert.equal(rep.store.integrity, 'ok');
    assert.equal(rep.store.lastBackup, null);

    assert.equal(rep.host.admission, 'absent');
    assert.equal(rep.host.enforcement, 'none');
    assert.equal(rep.gsd.state, 'ok');
    assert.equal(rep.gsd.version, '1.17.0');
    assert.equal(rep.graphify.state, 'absent');
    assert.equal(rep.runs.read, true);
    assert.equal(rep.runs.total, 0);
    assert.ok(rep.findings.every((finding) => finding.level === 'warning'), `no error finding: ${JSON.stringify(rep.findings)}`);
    assert.ok(rep.findings.some((finding) => finding.area === 'host'), 'the absent host is a warning');
  });

  it('with a gsd-core 1.18.0 it still fills every other section and exits 3 with a gsd finding that has a fix', () => {
    const f = doctorFixture();
    initStore(f);
    const r = doctor(f, ['--json'], { GSD_HOME: fakeGsd('1.18.0') });
    assert.equal(r.code, 3, r.stdout + r.stderr);
    const rep = reportOf(r);
    assert.equal(rep.gsd.state, 'incompatible');
    assert.equal(rep.gsd.version, '1.18.0');
    const finding = rep.findings.find((x) => x.area === 'gsd');
    assert.equal(finding?.level, 'error');
    assert.match(finding?.message ?? '', /1\.18\.0/);
    assert.match(finding?.fix ?? '', /1\.17\.x/);
    assert.equal(rep.store.state, 'ok');
    assert.equal(rep.runtime.node.ok, true);
    assert.equal(rep.host.admission, 'absent');
  });

  it('with a store of schema 9 it says `written by a newer AVARICE`, exits 3, and changes nothing in the store', () => {
    const f = doctorFixture();
    initStore(f);
    const handle = new DatabaseSync(statePath(f));
    handle.exec("INSERT INTO schema_migrations (version, applied_at, checksum) VALUES (9, '2030-01-01T00:00:00.000Z', 'x')");
    handle.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    handle.close();
    const before = digestOfFile(statePath(f));
    const r = doctor(f, ['--json']);
    assert.equal(r.code, 3, r.stdout + r.stderr);
    const rep = reportOf(r);
    assert.equal(rep.store.state, 'newer');
    assert.equal(rep.store.schema, 9);
    const finding = rep.findings.find((x) => x.area === 'store');
    assert.equal(finding?.level, 'error');
    assert.match(finding?.message ?? '', /written by a newer AVARICE/);
    assert.ok((finding?.fix ?? '') !== '');
    assert.equal(rep.runs.read, false, 'a store this build cannot read as its own is not read for runs');
    assert.equal(digestOfFile(statePath(f)), before, 'the store file is byte-identical');
  });

  it('prints the same content as text, one line per section, and reports a missing store without creating one', () => {
    const f = doctorFixture();
    const r = doctor(f);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    for (const label of ['profile', 'runtime', 'store', 'host', 'gsd', 'graphify', 'adapters', 'runs']) assert.match(r.stdout, new RegExp(`^${label}\\s`, 'm'), `the ${label} line`);
    assert.match(r.stdout, /none yet/);
    assert.throws(() => statSync(statePath(f)), /ENOENT/, 'doctor does not create the store');
  });

  it('rejects an argument and an unknown option with the usage exit', () => {
    const f = doctorFixture();
    assert.equal(doctor(f, ['now']).code, 64);
    assert.equal(doctor(f, ['--fix']).code, 64);
  });

  describe('offline', { skip: !offlineAvailable() }, () => {
    it('finishes in under 2,000 ms under the network-denied wrapper', () => {
      const f = doctorFixture();
      initStore(f);
      mkdirSync(join(f.home, '.claude'), { recursive: true });
      const started = Date.now();
      const r = runOffline(['doctor', '--json'], { roots: f.roots, entry: PRODUCTION_ENTRY, env: f.env });
      const elapsed = Date.now() - started;
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.ok(elapsed < 2000, `doctor took ${elapsed} ms`);
      assert.equal(reportOf(r).store.state, 'ok');
    });
  });
});

// A `gh` that logs what it was asked, prints a token-shaped line the way a real one prints its login, and exits with the code it was built with.
const TOKEN = `ghp_${'a1B2c3D4e5F6g7H8i9J0'.repeat(2)}ab`;
function fakeGh(exitCode: number): { dir: string; log: string } {
  const dir = temp('doctor-gh');
  const log = join(dir, 'calls.log');
  writeFileSync(join(dir, 'gh'), `#!/bin/sh\necho "$@" >> '${log}'\necho 'Token: ${TOKEN}'\nexit ${exitCode}\n`);
  chmodSync(join(dir, 'gh'), 0o755);
  return { dir, log };
}

const withGh = (gh: { dir: string }): { PATH: string } => ({ PATH: `${gh.dir}:${process.env['PATH'] ?? ''}` });

describe('--online adds a reachability section from the delegated provider and prints no token (OPS-1)', () => {
  const extended = (): DoctorFixture => {
    const f = doctorFixture();
    writeProfileConfig(f, 'personal-extended', { credentials: { github: 'delegated:gh' } });
    return f;
  };

  it("runs the CLI's own auth status for a delegated:gh reference and reports ok without printing the token", () => {
    const f = extended();
    const gh = fakeGh(0);
    const r = doctor(f, ['--online', '--json', '--profile', 'personal-extended'], withGh(gh));
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const rep = reportOf(r);
    assert.deepEqual(rep.online?.checks, [{ name: 'github', reference: 'delegated:gh', status: 'ok' }]);
    assert.equal(readFileSync(gh.log, 'utf8').trim(), 'auth status');
    assert.ok(!r.stdout.includes(TOKEN) && !r.stderr.includes(TOKEN), 'the token the CLI printed is nowhere in the output');
  });

  it("reports the CLI's failure as a warning with a fix, and exits 0", () => {
    const f = extended();
    const gh = fakeGh(1);
    const r = doctor(f, ['--online', '--json', '--profile', 'personal-extended'], withGh(gh));
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const rep = reportOf(r);
    assert.equal(rep.online?.checks[0]?.status, 'gh auth status failed (exit 1)');
    const finding = rep.findings.find((x) => x.area === 'online');
    assert.equal(finding?.level, 'warning');
    assert.match(finding?.fix ?? '', /gh auth login/);
    assert.ok(!r.stdout.includes(TOKEN));
  });

  it('says so when the CLI is not on PATH', () => {
    const f = extended();
    const rep = reportOf(doctor(f, ['--online', '--json', '--profile', 'personal-extended'], { PATH: temp('doctor-empty-path') }));
    assert.match(rep.online?.checks[0]?.status ?? '', /gh was not found on PATH/);
  });

  it('checks nothing under a profile whose class does not resolve delegated: references, and says why', () => {
    const f = doctorFixture();
    writeProfileConfig(f, 'personal-local', { credentials: { github: 'delegated:gh' } });
    const gh = fakeGh(0);
    const rep = reportOf(doctor(f, ['--online', '--json'], withGh(gh)));
    assert.match(rep.online?.checks[0]?.status ?? '', /not checked: delegated: references are not resolved under personal-local/);
    assert.equal(existsSync(gh.log), false, 'the CLI was not run');
  });

  it('without --online no network call is attempted: the report has no online section and the CLI is never run, under the network-denied wrapper', { skip: !offlineAvailable() }, () => {
    const f = extended();
    const gh = fakeGh(0);
    const r = runOffline(['doctor', '--json', '--profile', 'personal-extended'], { roots: f.roots, entry: PRODUCTION_ENTRY, env: { ...f.env, ...withGh(gh) } });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(reportOf(r).online, undefined);
    assert.equal(existsSync(gh.log), false);
  });
});

function rowCounts(f: DoctorFixture): string {
  const db = new DatabaseSync(statePath(f), { readOnly: true });
  try {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map((t) => t.name);
    return JSON.stringify(tables.map((name) => [name, (db.prepare(`SELECT count(*) AS n FROM ${name}`).get() as { n: number }).n]));
  } finally {
    db.close();
  }
}

describe('--repair deletes only orphaned temporary artifact files older than 1 hour', () => {
  it('removes the old one, keeps the newer one and every real artifact, and leaves every ledger row (counts unchanged)', () => {
    const f = doctorFixture();
    initStore(f);
    const shard = join(f.roots.AVARICE_DATA_ROOT, 'artifacts', 'ab');
    mkdirSync(shard, { recursive: true });
    const old = join(shard, '.tmp-abcdef012345-4242-aaaa');
    const recent = join(shard, '.tmp-abcdef012345-4243-bbbb');
    const real = join(shard, 'ab' + '0'.repeat(62));
    for (const file of [old, recent, real]) writeFileSync(file, 'x');
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
    utimesSync(old, twoHoursAgo, twoHoursAgo);
    utimesSync(real, twoHoursAgo, twoHoursAgo);
    const before = rowCounts(f);
    const storeBefore = digestOfFile(statePath(f));

    const rep = reportOf(doctor(f, ['--repair', '--json']));
    assert.deepEqual(rep.repair, { removed: 1, kept: 1 });
    assert.equal(existsSync(old), false);
    assert.equal(existsSync(recent), true);
    assert.equal(existsSync(real), true, 'a stored artifact is never touched, whatever its age');
    assert.equal(rowCounts(f), before);
    assert.equal(digestOfFile(statePath(f)), storeBefore, 'the store file is untouched');
    assert.equal(reportOf(doctor(f, ['--json'])).repair, undefined, 'without --repair the report has no repair section');
  });

  it('deletes nothing without the flag', () => {
    const f = doctorFixture();
    initStore(f);
    const shard = join(f.roots.AVARICE_DATA_ROOT, 'artifacts', 'cd');
    mkdirSync(shard, { recursive: true });
    const old = join(shard, '.tmp-abcdef012345-4242-aaaa');
    writeFileSync(old, 'x');
    const longAgo = new Date(Date.now() - 48 * 3_600_000);
    utimesSync(old, longAgo, longAgo);
    assert.equal(doctor(f, ['--json']).code, 0);
    assert.equal(existsSync(old), true);
  });
});

describe('--extensions reports configuration directories, duplicate registrations and instruction conflicts as warnings', () => {
  it('warns about an attended hook in two directories, a skill of the same name in both, and a CLAUDE.md that pushes without approval', () => {
    const f = doctorFixture();
    const active = join(f.home, 'claude-a');
    const other = join(f.home, '.claude');
    const hook = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node hook.ts --event pre --attended --avarice-attended-hook' }] }] } };
    for (const dir of [active, other]) {
      mkdirSync(join(dir, 'skills', 'avarice-run'), { recursive: true });
      writeFileSync(join(dir, 'settings.json'), JSON.stringify(hook));
      writeFileSync(join(dir, 'skills', 'avarice-run', 'SKILL.md'), '---\nname: avarice-run\n---\n');
    }
    mkdirSync(join(active, 'skills', 'avarice-only-here'), { recursive: true });
    writeFileSync(join(active, 'CLAUDE.md'), ['# Rules', 'After each task run git push to publish it.', "Never run git push without the owner's approval.", 'Open a pull request when the work is done.'].join('\n'));

    const r = doctor(f, ['--extensions', '--json'], { CLAUDE_CONFIG_DIR: active });
    assert.equal(r.code, 0, 'extensions findings are warnings only: ' + r.stdout + r.stderr);
    const rep = reportOf(r);
    assert.equal(rep.extensions?.activeConfigDir, active);
    assert.deepEqual(
      rep.extensions?.configDirs.map((d) => [d.path, d.active, d.attendedHookEntries, d.skills]),
      [
        [active, true, 1, ['avarice-only-here', 'avarice-run']],
        [other, false, 1, ['avarice-run']],
      ],
    );
    const messages = rep.findings.filter((x) => x.area === 'extensions');
    assert.ok(messages.every((x) => x.level === 'warning' && x.fix !== ''));
    assert.ok(messages.some((x) => /attended hook is registered in more than one/.test(x.message) && x.message.includes(active) && x.message.includes(other)), 'the hook in both directories');
    assert.ok(messages.some((x) => /skill avarice-run is installed in more than one/.test(x.message)), 'the duplicate skill');
    const lines = messages.filter((x) => /CLAUDE\.md line/.test(x.message)).map((x) => /line (\d+)/.exec(x.message)?.[1]);
    assert.deepEqual(lines, ['2', '4'], 'the push line and the pull request line; the line that asks for approval is not a conflict');
    assert.ok(!messages.some((x) => x.message.includes('avarice-only-here')), 'a skill present once is not a duplicate');
  });

  it('adds nothing without the flag', () => {
    const f = doctorFixture();
    const rep = reportOf(doctor(f, ['--json']));
    assert.equal(rep.extensions, undefined);
    assert.ok(!rep.findings.some((x) => x.area === 'extensions'));
  });
});

describe('doctor prints no secret (T-04-67)', () => {
  it('shows references as references, never resolves one, and a secret seeded in the store and one pasted into the config appear in neither the text nor the JSON', () => {
    const f = doctorFixture();
    writeProfileConfig(f, 'personal-local', { credentials: { github: 'keychain:github-token', pasted: TOKEN } });
    initStore(f);
    const db = new DatabaseSync(statePath(f));
    db.prepare('INSERT INTO adapter_configs (name, port, adapter, config_digest, descriptor_json) VALUES (?, ?, ?, ?, ?)').run(TOKEN, 'seeded', TOKEN, 'sha256:x', '{}');
    db.close();
    const flags = ['--online', '--extensions', '--repair'];
    for (const argv of [flags, [...flags, '--json']]) {
      const r = doctor(f, argv);
      const everything = r.stdout + r.stderr;
      assert.ok([0, 3].includes(r.code ?? -1), everything);
      assert.ok(!everything.includes(TOKEN), `the secret is in the output of doctor ${argv.join(' ')}`);
      assert.deepEqual(findSecrets(everything), [], 'no secret-shaped string');
      assert.match(everything, /keychain:github-token/, 'the reference is shown');
      assert.match(everything, /not a credential reference/, 'a secret pasted where a reference belongs is not echoed back');
    }
  });
});
