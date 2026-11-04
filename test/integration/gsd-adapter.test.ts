// Plan 01-09 Task 1: gsd-core discovery, identity and version check, the `incompatible` path, and the
// GsdOnboardingAdapter against the installed GSD. The fake gsd-core directories are generated here at run time.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { locateGsdCore } from '../../src/adapters/gsd/locate.ts';
import { runGsd } from '../../src/adapters/gsd/gsd-tools.ts';
import { GsdOnboardingAdapter } from '../../src/adapters/gsd/gsd-onboarding.ts';
import { SandboxedExecutor } from '../../src/adapters/exec/sandboxed-executor.ts';
import { GSD_ADMITTED_PACKAGE, GSD_ADMITTED_RANGE } from '../../src/ports/gsd-onboarding.ts';
import { REPO_ROOT, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';
import { writeFakeGsdCore } from '../helpers/fake-gsd-core.ts';
import { INTEL_FILE_NAMES, intelDocuments, serializeIntel } from '../fixtures/index-fixtures.ts';

const TEST_CLI = join(REPO_ROOT, 'test', 'helpers', 'test-cli.ts');
const REPO_FILES = {
  'README.md': '# scratch\n',
  'package.json': '{"name":"scratch"}\n',
  'src/index.ts': 'export const answer = 42;\n',
};

const executor = new SandboxedExecutor();
const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `avarice-${prefix}-`));
  cleanup.push(dir);
  return dir;
}

function rows<T>(roots: CliRoots, sql: string, ...params: Array<string | number>): T[] {
  const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
  try {
    return (db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    db.close();
  }
}

function fixture(): { roots: CliRoots; repo: ScratchRepo } {
  const roots = makeRoots();
  const repo = makeScratchRepo({ files: REPO_FILES });
  cleanup.push(roots.base, repo.base);
  return { roots, repo };
}

// The user's real home, read the way the adapter reads it (HOME), never a literal path.
const REAL_HOME = process.env['HOME'] ?? homedir();

describe('locateGsdCore', () => {
  it('falls through GSD_HOME and CLAUDE_CONFIG_DIR to $HOME/.claude/gsd-core and returns the installed 1.17.x', () => {
    const configDir = temp('cfg'); // a config dir with no gsd-core in it
    const located = locateGsdCore({ HOME: REAL_HOME, CLAUDE_CONFIG_DIR: configDir });
    assert.ok(located.ok, JSON.stringify(located));
    assert.equal(located.value.gsdCoreDir, join(REAL_HOME, '.claude', 'gsd-core'));
    assert.equal(located.value.packageName, GSD_ADMITTED_PACKAGE);
    assert.match(located.value.version, /^1\.17\.\d+$/);
  });

  it('probes GSD_HOME first, then $CLAUDE_CONFIG_DIR/gsd-core, then $HOME/.claude/gsd-core', () => {
    const home = temp('home');
    const configDir = temp('cfg');
    const gsdHome = temp('gsdhome');
    writeFakeGsdCore(join(home, '.claude', 'gsd-core'), { version: '1.17.1' });
    writeFakeGsdCore(join(configDir, 'gsd-core'), { version: '1.17.2' });
    writeFakeGsdCore(gsdHome, { version: '1.17.3' });

    const first = locateGsdCore({ HOME: home, CLAUDE_CONFIG_DIR: configDir, GSD_HOME: gsdHome });
    assert.ok(first.ok);
    assert.equal(first.value.gsdCoreDir, gsdHome);
    assert.equal(first.value.version, '1.17.3');

    const second = locateGsdCore({ HOME: home, CLAUDE_CONFIG_DIR: configDir });
    assert.ok(second.ok);
    assert.equal(second.value.gsdCoreDir, join(configDir, 'gsd-core'));
    assert.equal(second.value.version, '1.17.2');

    const third = locateGsdCore({ HOME: home });
    assert.ok(third.ok);
    assert.equal(third.value.gsdCoreDir, join(home, '.claude', 'gsd-core'));
    assert.equal(third.value.version, '1.17.1');
  });

  it('returns unsupported, naming the admitted range, for a gsd-core that reports 1.18.0 (and does not fall through)', () => {
    const gsdHome = writeFakeGsdCore(temp('gsd118'), { version: '1.18.0' });
    const located = locateGsdCore({ HOME: REAL_HOME, GSD_HOME: gsdHome });
    assert.equal(located.ok, false);
    assert.ok(!located.ok);
    assert.equal(located.error.kind, 'unsupported');
    assert.ok(located.error.kind === 'unsupported');
    assert.match(located.error.reducedMode ?? '', new RegExp(GSD_ADMITTED_RANGE.replace('.', '\\.')));
    assert.match(located.error.detail ?? '', /1\.18\.0/);
  });

  it('rejects a gsd-tools whose identity is not @opengsd/gsd-core, even at a 1.17 version', () => {
    const gsdHome = writeFakeGsdCore(temp('other'), { version: '1.17.0', packageName: 'someone-else/gsd-core' });
    const located = locateGsdCore({ HOME: REAL_HOME, GSD_HOME: gsdHome });
    assert.ok(!located.ok);
    assert.equal(located.error.kind, 'unsupported');
    assert.ok(located.error.kind === 'unsupported');
    assert.match(located.error.detail ?? '', /someone-else\/gsd-core/);
  });

  it('reports not_found when no candidate holds bin/gsd-tools.cjs', () => {
    const located = locateGsdCore({ HOME: temp('empty-home'), CLAUDE_CONFIG_DIR: temp('empty-cfg') });
    assert.ok(!located.ok);
    assert.equal(located.error.kind, 'not_found');
  });

  it('hard-codes no Claude config directory and never runs /gsd-update', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.ts$/.test(entry.name)) {
          const text = readFileSync(full, 'utf8');
          if (/\.claude-edu|\/Users\/|gsd-update/.test(text)) offenders.push(full);
        }
      }
    };
    walk(join(REPO_ROOT, 'src'));
    assert.deepEqual(offenders, []);
  });
});

describe('runGsd', () => {
  it('maps exit 69 to unavailable, other failures to internal, and a hang to timeout', async () => {
    const dir = writeFakeGsdCore(temp('verbs'), {
      version: '1.17.0',
      script: [
        "if (args[0] === 'unavailable') { process.stderr.write('no stamp\\n'); process.exit(69); }",
        "if (args[0] === 'broken') { process.stdout.write('not json'); process.exit(0); }",
        "if (args[0] === 'hang') { setInterval(() => {}, 1000); return; }",
        "if (args[0] === 'echo') { process.stdout.write(JSON.stringify({ args, cwd: process.cwd() })); process.exit(0); }",
      ].join('\n'),
    });
    const cwd = temp('cwd');
    const unavailable = await runGsd(executor, dir, ['unavailable'], { cwd });
    assert.ok(!unavailable.ok);
    assert.equal(unavailable.error.kind, 'unavailable');
    const broken = await runGsd(executor, dir, ['broken'], { cwd });
    assert.ok(!broken.ok);
    assert.equal(broken.error.kind, 'internal');
    const echoed = await runGsd(executor, dir, ['echo', 'x'], { cwd });
    assert.ok(echoed.ok, JSON.stringify(echoed));
    const value = echoed.value as { args: string[]; cwd: string };
    assert.deepEqual(value.args, ['echo', 'x']);
    assert.equal(value.cwd.endsWith(cwd.split('/').pop() as string), true, 'runs with the requested cwd');
    const hung = await runGsd(executor, dir, ['hang'], { cwd, timeoutMs: 300 });
    assert.ok(!hung.ok);
    assert.equal(hung.error.kind, 'timeout');
  });

  it('dereferences an @file: output', async () => {
    const holder = temp('big');
    const payload = join(holder, 'out.json');
    writeFileSync(payload, JSON.stringify({ big: true }));
    const dir = writeFakeGsdCore(temp('file'), {
      version: '1.17.0',
      script: `if (args[0] === 'big') { process.stdout.write(${JSON.stringify(`@file:${payload}`)}); process.exit(0); }`,
    });
    const result = await runGsd(executor, dir, ['big'], { cwd: temp('cwd') });
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(result.value, { big: true });
  });
});

describe('GsdOnboardingAdapter against the installed GSD', () => {
  it('inspect reports the identity, the agents directory and the Phase 1 capabilities', () => {
    const located = locateGsdCore({ HOME: REAL_HOME, CLAUDE_CONFIG_DIR: temp('cfg') });
    assert.ok(located.ok);
    const adapter = new GsdOnboardingAdapter(located.value, { executor, dataRoot: temp('data'), home: REAL_HOME });
    const snapshot = adapter.inspect();
    assert.ok(snapshot.ok, JSON.stringify(snapshot));
    assert.equal(snapshot.value.packageName, GSD_ADMITTED_PACKAGE);
    assert.match(snapshot.value.version, /^1\.17\.\d+$/);
    assert.equal(snapshot.value.gsdCoreDir, located.value.gsdCoreDir);
    assert.equal(snapshot.value.agentsDir, join(located.value.gsdCoreDir, '..', 'agents'));
    for (const name of ['init-onboard', 'map-full', 'map-fast', 'stamp', 'verify-drift']) {
      assert.ok(snapshot.value.capabilities.includes(name), `capability ${name}`);
    }
    assert.equal(adapter.descriptor.port, 'gsd-onboarding');
    assert.equal(adapter.descriptor.adapter, 'gsd-onboarding');
    assert.equal(adapter.descriptor.version, '1.17');
    assert.equal(adapter.descriptor.offline, true);
    assert.equal(adapter.initPlanning().ok, false);
  });
});

describe('onboarding with the discovered gsd-core', () => {
  it('ends incompatible with a gsd-core that reports 1.18.0: no staging workspace, no host invocation (S-36)', () => {
    const { roots, repo } = fixture();
    const gsd118 = writeFakeGsdCore(temp('gsd118'), { version: '1.18.0' });
    const r = runCli(['onboard', '--policy', 'onboarding', repo.path], {
      roots,
      entry: TEST_CLI,
      env: { GSD_HOME: gsd118, AVARICE_FAKE_HOST: '{}' },
    });
    assert.equal(r.code, 3, r.stderr + r.stdout);
    assert.match(r.stdout, /incompatible/);
    assert.match(r.stdout + r.stderr, /1\.18\.0/);
    assert.match(r.stdout + r.stderr, /1\.17\.x/);

    const [onboarding] = rows<{ state: string; staging_worktree: string | null }>(roots, 'SELECT state, staging_worktree FROM onboardings');
    assert.equal(onboarding?.state, 'incompatible');
    assert.equal(onboarding?.staging_worktree, null);
    assert.deepEqual(rows(roots, 'SELECT step FROM onboarding_steps'), [], 'no launch:map and no gsd step');
    assert.equal(existsSync(roots.AVARICE_WORK_ROOT) ? readdirSync(roots.AVARICE_WORK_ROOT).length : 0, 0, 'no staging workspace was created');
    const events = rows<{ data_json: string }>(roots, "SELECT data_json FROM events WHERE type = 'onboarding.transition' ORDER BY seq");
    const last = JSON.parse(events[events.length - 1]?.data_json ?? '{}') as { to: string; detail?: string; found?: string; admitted?: string };
    assert.equal(last.to, 'incompatible');
    assert.match(JSON.stringify(last), /1\.18\.0/);
    assert.match(JSON.stringify(last), /1\.17\.x/);
  });

  it('records the located gsd-core in adapter_configs and the snapshot as step gsd:inspect', () => {
    const { roots, repo } = fixture();
    const r = runCli(['onboard', '--policy', 'onboarding', repo.path], {
      roots,
      entry: TEST_CLI,
      env: { GSD_HOME: undefined, CLAUDE_CONFIG_DIR: temp('cfg'), AVARICE_FAKE_HOST: '{}' },
    });
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const configs = rows<{ name: string; port: string; adapter: string; descriptor_json: string }>(roots, "SELECT name, port, adapter, descriptor_json FROM adapter_configs WHERE name = 'gsd'");
    assert.equal(configs.length, 1);
    assert.equal(configs[0]?.port, 'gsd-onboarding');
    assert.equal(configs[0]?.adapter, 'gsd-onboarding');
    const descriptor = JSON.parse(configs[0]?.descriptor_json ?? '{}') as { version: string; capabilities: Record<string, boolean> };
    assert.equal(descriptor.version, '1.17');

    const [step] = rows<{ status: string; result_json: string }>(roots, "SELECT status, result_json FROM onboarding_steps WHERE step = 'gsd:inspect'");
    assert.ok(step, 'step gsd:inspect is recorded');
    const snapshot = JSON.parse(step.result_json) as { version: string; packageName: string; gsdCoreDir: string; agentsDir: string; capabilities: string[] };
    assert.equal(snapshot.packageName, GSD_ADMITTED_PACKAGE);
    assert.match(snapshot.version, /^1\.17\.\d+$/);
    assert.equal(snapshot.gsdCoreDir, join(REAL_HOME, '.claude', 'gsd-core'));
    assert.ok(snapshot.capabilities.includes('init-onboard'));
    assert.equal(snapshot.agentsDir, join(snapshot.gsdCoreDir, '..', 'agents'));

    // The project record carries the version the adapter read, not `unknown`.
    const [record] = rows<{ gsd_version: string; body_json: string }>(roots, 'SELECT gsd_version, body_json FROM project_records');
    assert.equal(record?.gsd_version, snapshot.version);
    assert.equal((JSON.parse(record?.body_json ?? '{}') as { gsd: { version: string } }).gsd.version, snapshot.version);
  });
});

describe('GsdOnboardingAdapter.intelSnapshot against the installed GSD (decision A)', () => {
  function intelDir(): string {
    const dir = temp('intel-snapshot');
    mkdirSync(join(dir, '.planning', 'intel'), { recursive: true });
    const files = serializeIntel(intelDocuments());
    for (const name of INTEL_FILE_NAMES) writeFileSync(join(dir, '.planning', 'intel', name), files[name]);
    // The one capability switch GSD checks.
    mkdirSync(join(dir, '.planning'), { recursive: true });
    writeFileSync(join(dir, '.planning', 'config.json'), JSON.stringify({ intel: { enabled: true } }));
    return dir;
  }

  it('writes `.planning/intel/.last-refresh.json` with a hash of each of the five files and reports how many, then `intel diff` agrees', async () => {
    const located = locateGsdCore({ HOME: REAL_HOME, CLAUDE_CONFIG_DIR: temp('cfg') });
    assert.ok(located.ok);
    const adapter = new GsdOnboardingAdapter(located.value, { executor, dataRoot: temp('data'), home: REAL_HOME });
    const dir = intelDir();
    const before = await adapter.intelDiff(dir);
    assert.ok(before.ok && before.value.noBaseline, 'no snapshot yet');
    const snapshot = await adapter.intelSnapshot(dir);
    assert.ok(snapshot.ok, JSON.stringify(snapshot));
    assert.deepEqual({ disabled: snapshot.value.disabled, saved: snapshot.value.saved, files: snapshot.value.files }, { disabled: false, saved: true, files: 5 });
    const written = JSON.parse(readFileSync(join(dir, '.planning', 'intel', '.last-refresh.json'), 'utf8')) as { hashes: Record<string, string> };
    assert.deepEqual(Object.keys(written.hashes).sort(), [...INTEL_FILE_NAMES].sort());
    const after = await adapter.intelDiff(dir);
    assert.ok(after.ok);
    assert.deepEqual({ noBaseline: after.value.noBaseline, changed: after.value.changed, added: after.value.added, removed: after.value.removed }, { noBaseline: false, changed: [], added: [], removed: [] });
    // A change after the snapshot is what `diff` then reports.
    writeFileSync(join(dir, '.planning', 'intel', 'stack.json'), '{"_meta":{"updated_at":"2026-01-01T00:00:00.000Z","version":1},"entries":{"x":1}}\n');
    const moved = await adapter.intelDiff(dir);
    assert.ok(moved.ok);
    assert.deepEqual(moved.value.changed, ['stack.json']);
  });

  it('writes nothing outside `.planning/intel` (the sandbox grants that one directory)', async () => {
    const located = locateGsdCore({ HOME: REAL_HOME, CLAUDE_CONFIG_DIR: temp('cfg') });
    assert.ok(located.ok);
    const adapter = new GsdOnboardingAdapter(located.value, { executor, dataRoot: temp('data'), home: REAL_HOME });
    const dir = intelDir();
    const listing = (): string[] => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name).slice(dir.length + 1)).sort();
    const before = listing();
    const snapshot = await adapter.intelSnapshot(dir);
    assert.ok(snapshot.ok);
    assert.deepEqual(listing().filter((f) => !before.includes(f)), ['.planning/intel/.last-refresh.json']);
  });
});

describe('GsdOnboardingAdapter.intelSnapshot reads GSD\'s answer strictly (a fake gsd-core)', () => {
  function adapterFor(answer: string, exit = 0): GsdOnboardingAdapter {
    const dir = writeFakeGsdCore(temp('intel-fake'), {
      version: '1.17.0',
      script: `if (args[0] === 'intel' && args[1] === 'snapshot') { process.stdout.write(${JSON.stringify(answer)}); process.exit(${exit}); }`,
    });
    return new GsdOnboardingAdapter({ gsdCoreDir: dir, version: '1.17.0', packageName: GSD_ADMITTED_PACKAGE }, { executor, dataRoot: temp('data'), home: REAL_HOME });
  }

  it('reports saved only when GSD says saved: true, and the file count it gives', async () => {
    const saved = await adapterFor('{"saved":true,"timestamp":"2026-11-03T00:00:00.000Z","files":5}').intelSnapshot(temp('s1'));
    assert.ok(saved.ok);
    assert.deepEqual(saved.value, { disabled: false, saved: true, files: 5 });
    const notSaved = await adapterFor('{"saved":false,"files":5}').intelSnapshot(temp('s2'));
    assert.ok(notSaved.ok);
    assert.equal(notSaved.value.saved, false, 'a snapshot GSD does not call saved is not saved');
    const absentField = await adapterFor('{"files":5}').intelSnapshot(temp('s3'));
    assert.ok(absentField.ok);
    assert.equal(absentField.value.saved, false);
  });

  it('reports a disabled capability as a result, and an error field or a failing exit as an error', async () => {
    const disabled = await adapterFor('{"disabled":true,"message":"off"}').intelSnapshot(temp('s4'));
    assert.ok(disabled.ok);
    assert.deepEqual(disabled.value, { disabled: true, saved: false, files: 0 });
    const errored = await adapterFor('{"error":"cannot write"}').intelSnapshot(temp('s5'));
    assert.equal(errored.ok, false);
    const failed = await adapterFor('{}', 1).intelSnapshot(temp('s6'));
    assert.equal(failed.ok, false);
  });
});
