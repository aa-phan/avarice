// Version, enforcement and compatibility findings of `avarice doctor` (plan 04-25; OPS-6, D-20, S-1, S-4, S-38, S-49). The real production CLI runs against fake `claude`
// executables of chosen versions (no model is called), fake gsd-core directories and temp profiles. The record of S-38 is a real one: a scratch repository is onboarded
// through the real CLI under the owner's installed gsd-core (1.17.x), and then doctor and `start` run under a gsd-core 1.18.0.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { recordCompatibility } from '../../src/app/doctor.ts';
import { disposeDoctorFixtures, doctor, doctorFixture, fakeGsd, reportOf, temp, track, writeProfileConfig } from '../helpers/doctor-fixtures.ts';
import type { DoctorFixture } from '../helpers/doctor-fixtures.ts';
import { makeFakeClaude } from '../helpers/fake-claude.ts';
import type { FakeClaudeScript } from '../helpers/fake-claude.ts';
import { PRODUCTION_ENTRY, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { commitConventions, makeRunRepo, onboardRunRepo, writeBrief } from '../helpers/run-fixtures.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

after(disposeDoctorFixtures);

function withClaude(script: FakeClaudeScript): { f: DoctorFixture; extra: Record<string, string> } {
  const f = doctorFixture();
  const fake = makeFakeClaude(script);
  track(fake.dir);
  return { f, extra: { AVARICE_CLAUDE_BIN: fake.bin } };
}

describe('a credential reference that is an environment variable is an error finding that names it (S-49)', () => {
  it('names env:GITHUB_TOKEN, says to use delegated:, keychain: or cmd:, exits 3, and the other sections are still filled', () => {
    const f = doctorFixture();
    writeProfileConfig(f, 'personal-local', { credentials: { github: 'env:GITHUB_TOKEN' } });
    const r = doctor(f, ['--json']);
    assert.equal(r.code, 3, r.stdout + r.stderr);
    const rep = reportOf(r);
    const finding = rep.findings.find((x) => x.area === 'profile');
    assert.equal(finding?.level, 'error');
    assert.match(finding?.message ?? '', /env:GITHUB_TOKEN/);
    assert.match(finding?.fix ?? '', /use delegated:, keychain: or cmd:/);
    assert.deepEqual(rep.profile.credentials, [{ name: 'github', reference: 'env:GITHUB_TOKEN' }]);
    assert.equal(rep.runtime.node.ok, true);
    assert.equal(rep.gsd.state, 'ok');
  });

  it('is not hidden by the normal composition: another command refuses the same config, doctor explains it', () => {
    const f = doctorFixture();
    writeProfileConfig(f, 'personal-local', { credentials: { github: 'env:GITHUB_TOKEN' } });
    const other = runCli(['install-host'], { roots: f.roots, entry: PRODUCTION_ENTRY, env: { ...f.env, CLAUDE_CONFIG_DIR: join(f.home, 'claude') } });
    assert.equal(other.code, 70, 'the normal composition stops on it');
    assert.equal(doctor(f).code, 3);
  });
});

describe('the host: admission, enforcement level and the fix (D-20, OPS-6)', () => {
  it('labels an unverified 2.1 patch `admitted (unverified patch)` and its enforcement enforced once the sandbox and the hook entry check out', () => {
    const { f, extra } = withClaude({ version: '2.1.330 (Claude Code)' });
    const rep = reportOf(doctor(f, ['--json'], extra));
    assert.equal(rep.host.claudeVersion, '2.1.330');
    assert.equal(rep.host.admission, 'admitted (unverified patch)');
    assert.equal(rep.host.refusal, null);
    assert.equal(rep.host.sandbox, 'ok');
    assert.equal(rep.host.hookEntry, 'readable');
    assert.equal(rep.host.enforcement, 'enforced');
    assert.ok(!rep.findings.some((x) => x.area === 'host'), 'an admitted host has no host finding');
  });

  it('labels a verified version `verified`', () => {
    const { f, extra } = withClaude({ version: '2.1.319 (Claude Code)' });
    const rep = reportOf(doctor(f, ['--json'], extra));
    assert.equal(rep.host.admission, 'verified');
    assert.equal(rep.host.enforcement, 'enforced');
  });

  it('refuses 2.2.0, reports enforcement restricted because the restricted launch is available, and the fix names --restricted', () => {
    const { f, extra } = withClaude({ version: '2.2.0 (Claude Code)' });
    const r = doctor(f, ['--json'], extra);
    assert.equal(r.code, 0, 'a refused host is a warning, not an error');
    const rep = reportOf(r);
    assert.equal(rep.host.admission, 'refused');
    assert.equal(rep.host.refusal, 'host-minor-unverified');
    assert.equal(rep.host.restricted, true);
    assert.equal(rep.host.enforcement, 'restricted');
    const finding = rep.findings.find((x) => x.area === 'host');
    assert.equal(finding?.level, 'warning');
    assert.match(finding?.fix ?? '', /--restricted/);
  });

  it('reports enforcement none when no claude is found, and says how to get one', () => {
    const f = doctorFixture();
    const rep = reportOf(doctor(f, ['--json']));
    assert.equal(rep.host.admission, 'absent');
    assert.equal(rep.host.claudeVersion, null);
    assert.equal(rep.host.enforcement, 'none');
    assert.match(rep.findings.find((x) => x.area === 'host')?.fix ?? '', /AVARICE_CLAUDE_BIN/);
  });

  it('reports a version that is empty as `unknown` and refuses it, never admits it (empty edge)', () => {
    const { f, extra } = withClaude({ version: '' });
    const rep = reportOf(doctor(f, ['--json'], extra));
    assert.equal(rep.host.claudeVersion, 'unknown');
    assert.equal(rep.host.admission, 'refused');
    assert.notEqual(rep.host.enforcement, 'enforced');
    assert.match(rep.findings.find((x) => x.area === 'host')?.message ?? '', /no readable version/);
  });

  it('reports a version that is not a version as `unknown` and refuses it', () => {
    const { f, extra } = withClaude({ version: 'claude: command not found' });
    const rep = reportOf(doctor(f, ['--json'], extra));
    assert.equal(rep.host.claudeVersion, 'unknown');
    assert.equal(rep.host.admission, 'refused');
    assert.notEqual(rep.host.enforcement, 'enforced');
  });

  it('refuses an unverified patch whose --help no longer lists a flag the launch line uses, naming the flag', () => {
    const { f, extra } = withClaude({ version: '2.1.330 (Claude Code)', helpFlags: ['--setting-sources', '--permission-prompts', '--permission-mode', '--max-budget-usd', '--settings', '--plugin-dir', '--restricted'] });
    const rep = reportOf(doctor(f, ['--json'], extra));
    assert.equal(rep.host.admission, 'refused');
    assert.equal(rep.host.refusal, 'host-flag-missing:--agents');
    assert.notEqual(rep.host.enforcement, 'enforced');
  });
});

describe('the attended hook (S-4)', () => {
  it('is none until install-host writes the entry, then enforced for privileged approvals only', () => {
    const f = doctorFixture();
    const claudeDir = join(f.home, 'claude-config');
    const env = { CLAUDE_CONFIG_DIR: claudeDir };
    assert.equal(reportOf(doctor(f, ['--json'], env)).host.attended, 'none');
    const installed = runCli(['install-host'], { roots: f.roots, entry: PRODUCTION_ENTRY, env: { ...f.env, ...env } });
    assert.equal(installed.code, 0, installed.stdout + installed.stderr);
    const rep = reportOf(doctor(f, ['--json'], env));
    assert.equal(rep.host.attended, 'enforced (privileged approvals only)');
    assert.equal(rep.host.configDir, realpathSync(claudeDir));
  });
});

describe('recordCompatibility derives incompatibility; it is never written (S-38)', () => {
  it('is compatible under the same minor, and incompatible when nothing is installed, outside the range, or another minor', () => {
    assert.equal(recordCompatibility({ gsdVersion: '1.17.0' }, { version: '1.17.3' }), 'compatible');
    const none = recordCompatibility({ gsdVersion: '1.17.0' }, undefined, 'no gsd-core found');
    assert.ok(none !== 'compatible' && none.incompatible.includes('1.17.0') && none.incompatible.includes('no gsd-core found'));
    const outside = recordCompatibility({ gsdVersion: '1.17.0' }, { version: '1.18.0' });
    assert.ok(outside !== 'compatible');
    assert.equal(outside.fix, 'reinstall GSD 1.17.x or re-onboard after the adapter supports the new version');
    assert.match(outside.incompatible, /1\.18\.0/);
    const unknown = recordCompatibility({ gsdVersion: 'unknown' }, { version: '1.18.0' });
    assert.ok(unknown !== 'compatible' && unknown.fix.includes('1.17.x'), 'a record with no recorded version is judged by the range alone');
    assert.equal(recordCompatibility({ gsdVersion: 'unknown' }, { version: '1.17.1' }), 'compatible');
  });
});

interface Onboarded {
  roots: CliRoots;
  repo: ScratchRepo;
  brief: string;
}

function onboarded(): Onboarded {
  const roots = makeRoots();
  const repo = makeRunRepo();
  track(roots.base);
  track(repo.base);
  onboardRunRepo(roots, repo);
  commitConventions(repo);
  return { roots, repo, brief: writeBrief(join(roots.base, 'briefs')) };
}

// Every row of the tables as one comparable value: every table, or only the named ones.
function storeRows(roots: CliRoots, only?: readonly string[]): string {
  const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
  try {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map((t) => t.name).filter((name) => only === undefined || only.includes(name));
    return JSON.stringify(tables.map((name) => [name, db.prepare(`SELECT * FROM ${name}`).all()]));
  } finally {
    db.close();
  }
}

// What a refused `start` must leave alone: the project record, and every table a run would have been written to. (Any command that is not read-only also refreshes the
// recorded adapter descriptors, which is not what is under test.)
const RUN_TABLES = ['project_records', 'runs', 'contracts', 'budgets', 'work_items'] as const;

describe('S-38: a record built under one GSD is incompatible under another, doctor says so, and `start` refuses', () => {
  it('lists the record incompatible with its fix, ties it to its revision and GSD version, and `start` exits 3 naming `incompatible`; the store is byte-identical before and after both', () => {
    const o = onboarded();
    const f: DoctorFixture = { roots: o.roots, home: temp('doctor-home'), env: { GSD_HOME: fakeGsd('1.18.0'), AVARICE_GRAPHIFY_BIN: '/nonexistent' } };
    f.env['HOME'] = f.home;
    const before = storeRows(o.roots);
    const beforeRuns = storeRows(o.roots, RUN_TABLES);
    assert.match(before, /"gsd_version":"1\.17\.\d+"/, 'the record was built under the owner\'s gsd-core 1.17.x');

    const d = doctor(f, ['--json']);
    assert.equal(d.code, 3, d.stdout + d.stderr);
    const rep = reportOf(d);
    assert.equal(rep.records.length, 1);
    const record = rep.records[0];
    assert.equal(record?.compatibility, 'incompatible');
    assert.match(record?.gsdVersion ?? '', /^1\.17\.\d+$/);
    assert.match(record?.onboardedRevision ?? '', /^(?:git:)?[0-9a-f]{40}$/);
    const finding = rep.findings.find((x) => x.area === 'records');
    assert.equal(finding?.level, 'error');
    assert.equal(finding?.fix, 'reinstall GSD 1.17.x or re-onboard after the adapter supports the new version');
    assert.match(finding?.message ?? '', /incompatible/);
    assert.equal(storeRows(o.roots), before, 'doctor left every row as it was');

    const started = runCli(['start', '--brief', o.brief, '--policy', 'routine'], { roots: o.roots, entry: PRODUCTION_ENTRY, cwd: o.repo.path, env: f.env });
    assert.equal(started.code, 3, started.stdout + started.stderr);
    assert.match(started.stderr, /incompatible/);
    assert.match(started.stderr, /reinstall GSD 1\.17\.x or re-onboard after the adapter supports the new version/);
    assert.equal(storeRows(o.roots, RUN_TABLES), beforeRuns, 'start created no run and changed no record row (byte-identical project_records, no run, contract or budget)');
  });

  it('does not refuse a start for compatibility when the installed gsd-core is of the record\'s line', () => {
    const o = onboarded();
    const compatible = runCli(['start', '--brief', o.brief, '--policy', 'routine'], { roots: o.roots, entry: PRODUCTION_ENTRY, cwd: o.repo.path });
    assert.doesNotMatch(compatible.stderr, /incompatible/, compatible.stderr);
  });
});
