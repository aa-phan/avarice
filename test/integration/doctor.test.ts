// `avarice doctor` (plan 04-25; OPS-1, OPS-6, D-20, S-1, S-4, S-38, S-49). Doctor diagnoses the installation offline and read-only on its own composition, so it reports the
// problems the normal composition refuses to start on: a GSD outside the adapter range, a store written by a newer AVARICE, an absent host. Every profile, repository,
// gsd-core, `claude` and configuration directory here is a temp directory; no model is called and the owner's real profile is never read (HOME is a temp directory too).
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { disposeDoctorFixtures, doctor, doctorFixture, fakeGsd, initStore, reportOf, statePath } from '../helpers/doctor-fixtures.ts';
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
