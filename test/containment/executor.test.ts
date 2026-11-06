// Plan 01-13 Task 1: AVARICE's own subprocesses run under an OS sandbox (T-01-36). The commands here are the
// hostile ones a repository script, an interpreter one-liner or a symlink would try against a staging tree.
// Everything is a temp directory; the sandbox is the macOS `sandbox-exec`.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { buildSeatbeltProfile } from '../../src/adapters/exec/seatbelt-profile.ts';
import { SandboxedExecutor } from '../../src/adapters/exec/sandboxed-executor.ts';
import { GsdOnboardingAdapter } from '../../src/adapters/gsd/gsd-onboarding.ts';
import { locateGsdCore } from '../../src/adapters/gsd/locate.ts';
import type { CommandExecutor, CommandResult, CommandSpec } from '../../src/ports/command-executor.ts';
import type { Result } from '../../src/domain/result.ts';
import { writeLoggingGsdCore } from '../helpers/fake-gsd-core.ts';
import { makeScratchStaging, spec, treeDigest } from '../helpers/sandbox.ts';

const SANDBOX_AVAILABLE = existsSync('/usr/bin/sandbox-exec');
const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function staging() {
  const s = makeScratchStaging();
  cleanup.push(s.base);
  return s;
}

async function run(executor: CommandExecutor, command: CommandSpec): Promise<CommandResult> {
  const result = await executor.run(command);
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}

describe('buildSeatbeltProfile', () => {
  it('denies network and writes, then allows the declared subpaths, the temp areas and the tty devices', () => {
    const s = staging();
    const out = join(s.root, '.planning');
    const secret = join(s.base, 'secrets');
    mkdirSync(secret);
    const built = buildSeatbeltProfile({ writePaths: [out], denyReadPaths: [secret] });
    assert.ok(built.ok, JSON.stringify(built));
    const text = built.value;
    assert.match(text, /\(deny network\*\)/);
    assert.ok(text.indexOf('(deny file-write*)') > -1);
    assert.ok(text.indexOf('(deny file-write*)') < text.indexOf(`(subpath "${out}")`), 'the allow follows the deny');
    for (const needle of ['/private/var/folders', '/private/tmp', '/dev/null', '/dev/dtracehelper', '^/dev/tty']) {
      assert.ok(text.includes(needle), `profile allows ${needle}`);
    }
    assert.ok(text.includes(`(deny file-read* (subpath "${secret}"))`), 'one read denial per denyRead path');
  });

  it('writes one read allowance per allowReadPaths entry after every read denial, so the specific allowance wins (plan 02-20)', () => {
    const s = staging();
    const parent = join(s.base, 'work-parent');
    const own = join(parent, 'run', 'clone');
    mkdirSync(own, { recursive: true });
    const built = buildSeatbeltProfile({ writePaths: [], denyReadPaths: [parent], allowReadPaths: [own] });
    assert.ok(built.ok, JSON.stringify(built));
    const lines = built.value.split('\n');
    const deny = lines.indexOf(`(deny file-read* (subpath "${parent}"))`);
    const allow = lines.indexOf(`(allow file-read* (subpath "${own}"))`);
    assert.ok(deny > -1 && allow > deny, 'the allowance follows the denial');
    const none = buildSeatbeltProfile({ writePaths: [], denyReadPaths: [parent] });
    assert.ok(none.ok);
    assert.ok(!none.value.includes('(allow file-read*'), 'no read allowance unless asked for');
  });

  it('gives back only the metadata of the directories between a denied path and an allowed one below it, one literal each (plan 02-21)', () => {
    const s = staging();
    const parent = join(s.base, 'work-parent');
    const own = join(parent, 'profile', 'run', 'clone');
    mkdirSync(own, { recursive: true });
    const built = buildSeatbeltProfile({ writePaths: [], denyReadPaths: [parent], allowReadPaths: [own] });
    assert.ok(built.ok, JSON.stringify(built));
    const metadata = built.value.split('\n').filter((line) => line.startsWith('(allow file-read-metadata'));
    assert.deepEqual(metadata, [parent, join(parent, 'profile'), join(parent, 'profile', 'run')].map((p) => `(allow file-read-metadata (literal "${p}"))`));
    // Nothing above the denied path, nothing below the allowed one, no content or listing rule beyond the allowance itself.
    assert.ok(!built.value.includes(`(literal "${s.base}")`));
    assert.ok(!built.value.includes(`(literal "${own}")`));
    assert.equal(built.value.split('\n').filter((line) => line.startsWith('(allow file-read*')).length, 1);
    // An allowed path that is not inside a denied one needs nothing back.
    const outside = join(s.base, 'elsewhere');
    mkdirSync(outside, { recursive: true });
    const free = buildSeatbeltProfile({ writePaths: [], denyReadPaths: [parent], allowReadPaths: [outside] });
    assert.ok(free.ok);
    assert.ok(!free.value.includes('file-read-metadata'));
  });

  it('resolves symlinks in every path before writing them', () => {
    const s = staging();
    const link = join(s.base, 'link');
    symlinkSync(s.root, link);
    const built = buildSeatbeltProfile({ writePaths: [join(link, '.planning')], denyReadPaths: [] });
    assert.ok(built.ok);
    assert.ok(built.value.includes(`(subpath "${join(s.root, '.planning')}")`));
    assert.ok(!built.value.includes(link), 'the symlink path itself is not used');
  });

  it('allows outbound connections to the named loopback ports only, one line each, after (deny network*)', () => {
    const built = buildSeatbeltProfile({ writePaths: [], denyReadPaths: [], allowLoopbackPorts: [18081, 18082] });
    assert.ok(built.ok, JSON.stringify(built));
    const lines = built.value.split('\n');
    const allowLines = lines.filter((l) => l.includes('remote ip'));
    assert.deepEqual(allowLines, ['(allow network-outbound (remote ip "localhost:18081"))', '(allow network-outbound (remote ip "localhost:18082"))']);
    assert.ok(lines.indexOf('(deny network*)') < lines.indexOf(allowLines[0] ?? ''), 'the allowance follows the denial');
    const none = buildSeatbeltProfile({ writePaths: [], denyReadPaths: [] });
    assert.ok(none.ok);
    assert.ok(!none.value.includes('remote ip'), 'no loopback allowance unless asked for');
  });

  it('refuses a loopback port that is not an integer from 1 to 65535', () => {
    for (const bad of [0, 70000, 1.5, '80', -1, Number.NaN, 65536] as unknown as number[]) {
      const built = buildSeatbeltProfile({ writePaths: [], denyReadPaths: [], allowLoopbackPorts: [bad] });
      assert.ok(!built.ok, `port ${String(bad)} must be refused`);
      assert.equal(built.error.kind, 'invalid');
      assert.equal((built.error as { field?: string }).field, 'allowLoopbackPorts');
    }
  });

  it('rejects a path with a double quote or a newline', () => {
    for (const bad of ['/tmp/a"b', '/tmp/a\nb']) {
      const built = buildSeatbeltProfile({ writePaths: [bad], denyReadPaths: [] });
      assert.ok(!built.ok, `write path ${JSON.stringify(bad)}`);
      const denied = buildSeatbeltProfile({ writePaths: [], denyReadPaths: [bad] });
      assert.ok(!denied.ok, `deny path ${JSON.stringify(bad)}`);
    }
  });
});

describe('SandboxedExecutor', { skip: !SANDBOX_AVAILABLE }, () => {
  const executor = new SandboxedExecutor();

  it('publishes an executor descriptor that is offline and says the sandbox is enforced', () => {
    assert.equal(executor.descriptor.port, 'executor');
    assert.equal(executor.descriptor.adapter, 'local-sandbox-exec');
    assert.equal(executor.descriptor.offline, true);
    assert.equal(executor.descriptor.attributes?.['enforcement'], 'enforced');
  });

  const attacks: Array<[string, (root: string) => string[]]> = [
    ['sed -i', () => ['sed', '-i', '', 's/a/b/', 'src/a.ts']],
    ['python3 open().write', () => ['python3', '-c', "open('src/a.ts','a').write('x')"]],
    ['node -e fs.writeFileSync', () => [process.execPath, '-e', "require('fs').writeFileSync('src/a.ts','x')"]],
    ['a repository script', () => ['sh', 'scripts/x.sh']],
  ];
  for (const [name, argv] of attacks) {
    it(`${name} leaves every staging source file byte-identical`, async () => {
      const s = staging();
      const before = treeDigest(s.root);
      const result = await run(executor, spec(s.root, argv(s.root), { writePaths: [join(s.root, '.planning')] }));
      assert.equal(result.status, 'failed', `${name} must fail inside the sandbox: ${result.stderr}`);
      assert.equal(treeDigest(s.root), before);
      assert.equal(readFileSync(join(s.root, 'src', 'a.ts'), 'utf8'), 'export const a = 1;\n');
      assert.equal(existsSync(join(s.root, 'src', 'b.ts')), false);
    });
  }

  it('a write through a symlink that points outside the writable path leaves staging byte-identical', async () => {
    const s = staging();
    symlinkSync(join(s.root, 'src'), join(s.root, '.planning', 'link'));
    const before = treeDigest(s.root);
    const result = await run(
      executor,
      spec(s.root, ['sh', '-c', 'echo hostile > .planning/link/b.ts'], { writePaths: [join(s.root, '.planning')] }),
    );
    assert.equal(result.status, 'failed');
    assert.equal(treeDigest(s.root), before);
  });

  it('lets the command write the declared path', async () => {
    const s = staging();
    const result = await run(executor, spec(s.root, ['sh', '-c', 'echo fine > .planning/ok.txt'], { writePaths: [join(s.root, '.planning')] }));
    assert.equal(result.status, 'passed', result.stderr);
    assert.equal(readFileSync(join(s.root, '.planning', 'ok.txt'), 'utf8'), 'fine\n');
  });

  it('curl cannot reach the network, not even a local server', async () => {
    let hits = 0;
    const server = createServer((_req, res) => {
      hits += 1;
      res.end('reachable');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    try {
      const s = staging();
      const result = await run(executor, spec(s.root, ['curl', '-sS', '--noproxy', '*', '--max-time', '5', url]));
      assert.equal(result.status, 'failed');
      assert.notEqual(result.exitCode, 0);
      assert.equal(hits, 0, 'the server saw no request');
    } finally {
      server.close();
    }
  });

  describe('allowLoopbackPorts', () => {
    const CONNECT = (port: number): string[] => [
      process.execPath,
      '-e',
      `const s=require('net').connect(${port},'127.0.0.1');s.on('connect',()=>{console.log('connected');s.destroy();process.exit(0)});s.on('error',(e)=>{console.error(e.code);process.exit(3)})`,
    ];

    async function twoServers(): Promise<{ a: number; b: number; close: () => void; hits: () => number }> {
      const { createServer: tcp } = await import('node:net');
      let hits = 0;
      const mk = (): ReturnType<typeof tcp> => tcp((c) => {
        hits += 1;
        c.destroy();
      });
      const sa = mk();
      const sb = mk();
      await Promise.all([sa, sb].map((x) => new Promise<void>((r) => x.listen(0, '127.0.0.1', r))));
      return { a: (sa.address() as AddressInfo).port, b: (sb.address() as AddressInfo).port, close: () => { sa.close(); sb.close(); }, hits: () => hits };
    }

    it('reaches the named port and no other loopback port', async () => {
      const servers = await twoServers();
      try {
        const s = staging();
        const ok = await run(executor, spec(s.root, CONNECT(servers.a), { allowLoopbackPorts: [servers.a] }));
        assert.equal(ok.status, 'passed', ok.stderr);
        assert.match(ok.stdout, /connected/);
        const refused = await run(executor, spec(s.root, CONNECT(servers.b), { allowLoopbackPorts: [servers.a] }));
        assert.equal(refused.status, 'failed');
        assert.notEqual(refused.exitCode, 0);
      } finally {
        servers.close();
      }
    });

    it('without the field the command reaches neither port', async () => {
      const servers = await twoServers();
      try {
        const s = staging();
        for (const port of [servers.a, servers.b]) {
          const result = await run(executor, spec(s.root, CONNECT(port)));
          assert.equal(result.status, 'failed');
          assert.notEqual(result.exitCode, 0);
        }
        assert.equal(servers.hits(), 0, 'no connection was accepted');
      } finally {
        servers.close();
      }
    });

    it('refuses a malformed port with an invalid result naming the field and spawns nothing', async () => {
      const s = staging();
      const marker = join(s.root, '.planning', 'ran.txt');
      for (const bad of [0, 70000, 1.5, '80'] as unknown as number[]) {
        const result = await executor.run(
          spec(s.root, ['sh', '-c', `echo ran > ${marker}`], { writePaths: [join(s.root, '.planning')], allowLoopbackPorts: [bad] }),
        );
        assert.ok(!result.ok, `port ${String(bad)}`);
        assert.equal(result.error.kind, 'invalid');
        assert.equal((result.error as { field?: string }).field, 'allowLoopbackPorts');
        assert.equal(existsSync(marker), false, 'nothing was spawned');
      }
    });
  });

  it('a read of a denyRead directory fails and the same read elsewhere works', async () => {
    const s = staging();
    const secret = join(s.base, 'secrets');
    mkdirSync(secret);
    writeFileSync(join(secret, 'token'), 'hunter2\n');
    const denied = await run(executor, spec(s.root, ['cat', join(secret, 'token')], { denyReadPaths: [secret] }));
    assert.equal(denied.status, 'failed');
    assert.ok(!denied.stdout.includes('hunter2'));
    const allowed = await run(executor, spec(s.root, ['cat', join(secret, 'token')]));
    assert.equal(allowed.stdout, 'hunter2\n');
  });

  it('gives the command only the environment it was given', async () => {
    const s = staging();
    const result = await run(executor, spec(s.root, ['/usr/bin/env'], { env: { PATH: '/usr/bin:/bin', ONLY: 'this' } }));
    const lines = result.stdout.trim().split('\n').filter((l) => !l.startsWith('PWD=') && !l.startsWith('OLDPWD=') && !l.startsWith('_=') && !l.startsWith('SHLVL='));
    assert.deepEqual(lines.sort(), ['ONLY=this', 'PATH=/usr/bin:/bin']);
  });

  it('cuts a stream at the output limit with a marker', async () => {
    const s = staging();
    const result = await run(executor, spec(s.root, ['sh', '-c', 'yes x | head -c 100000'], { outputLimitBytes: 1000 }));
    assert.equal(result.truncated, true);
    assert.ok(result.stdout.length < 1200, `stdout kept ${result.stdout.length} characters`);
    assert.match(result.stdout, /output truncated/);
  });

  it('a command over its timeout ends timed_out and its process group is gone', async () => {
    const s = staging();
    const started = Date.now();
    const result = await run(
      executor,
      spec(s.root, ['sh', '-c', 'echo $$; sleep 30 & wait'], { timeoutMs: 2500 }),
    );
    assert.equal(result.status, 'timed_out');
    assert.ok(Date.now() - started < 10_000, 'ended long before the sleep would');  // the script prints its pid before the timeout, even on a loaded machine
    const leader = Number(result.stdout.trim().split('\n')[0]);
    assert.ok(Number.isInteger(leader) && leader > 1, `leader pid ${result.stdout}`);
    assert.throws(() => process.kill(-leader, 0), { code: 'ESRCH' }, 'no process of the group is left');
  });

  it('an aborted command ends cancelled', async () => {
    const s = staging();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const result = await executor.run(spec(s.root, ['sleep', '30']), controller.signal);
    assert.ok(result.ok);
    assert.equal(result.value.status, 'cancelled');
  });

  it('rejects a relative cwd', async () => {
    const result = await executor.run(spec('relative/dir', ['true']));
    assert.ok(!result.ok);
    assert.equal(result.error.kind, 'invalid');
  });
});

describe('without a working sandbox', { skip: !SANDBOX_AVAILABLE }, () => {
  it('returns unavailable and spawns nothing when the probe fails', async () => {
    const broken = new SandboxedExecutor({ sandboxExecPath: '/usr/bin/false' });
    assert.equal(broken.descriptor.attributes?.['enforcement'], 'none');
    const s = staging();
    const marker = join(s.root, '.planning', 'ran.txt');
    const result: Result<CommandResult> = await broken.run(
      spec(s.root, ['sh', '-c', `echo ran > ${marker}`], { writePaths: [join(s.root, '.planning')] }),
    );
    assert.ok(!result.ok);
    assert.equal(result.error.kind, 'unavailable');
    assert.equal(existsSync(marker), false, 'the command was not run');
  });

  it('a GSD verb is not run unsandboxed when the sandbox is unavailable', async () => {
    const real = locateGsdCore(process.env);
    assert.ok(real.ok, JSON.stringify(real));
    const s = staging();
    const log = join(s.base, 'calls.log');
    const shim = writeLoggingGsdCore(join(s.base, 'gsd'), log, join(real.value.gsdCoreDir, 'bin', 'gsd-tools.cjs'));
    const adapter = new GsdOnboardingAdapter(
      { gsdCoreDir: shim, version: real.value.version, packageName: real.value.packageName },
      { executor: new SandboxedExecutor({ sandboxExecPath: '/usr/bin/false' }), dataRoot: join(s.base, 'data'), home: s.base },
    );
    const configured = await adapter.configure(s.root, [['commit_docs', 'false']]);
    assert.ok(!configured.ok);
    assert.equal(configured.error.kind, 'unavailable');
    assert.equal(existsSync(log), false, 'no gsd-tools process ran');
    assert.equal(existsSync(join(s.root, '.planning', 'config.json')), false);
  });
});

describe('GSD verbs through the executor', { skip: !SANDBOX_AVAILABLE }, () => {
  it('config-set still succeeds in staging, writes only .planning and is sent through the executor', async () => {
    const real = locateGsdCore(process.env);
    assert.ok(real.ok, JSON.stringify(real));
    const s = staging();
    const specs: CommandSpec[] = [];
    const inner = new SandboxedExecutor();
    const spy: CommandExecutor = {
      descriptor: inner.descriptor,
      run: (cmd, signal) => {
        specs.push(cmd);
        return inner.run(cmd, signal);
      },
    };
    const home = join(s.base, 'home');
    mkdirSync(home);
    const dataRoot = join(s.base, 'data');
    const adapter = new GsdOnboardingAdapter(real.value, { executor: spy, dataRoot, home });
    const before = treeDigest(join(s.root, 'src'));
    const applied = await adapter.configure(s.root, [['commit_docs', 'false']]);
    assert.ok(applied.ok, JSON.stringify(applied));
    const config = JSON.parse(readFileSync(join(s.root, '.planning', 'config.json'), 'utf8')) as { commit_docs: boolean };
    assert.equal(config.commit_docs, false);
    assert.equal(treeDigest(join(s.root, 'src')), before);

    assert.equal(specs.length, 1, 'one executor call for one setting');
    assert.deepEqual(specs[0]?.writePaths, [join(s.root, '.planning')]);
    assert.equal(specs[0]?.cwd, s.root);
    for (const denied of [dataRoot, join(home, '.ssh'), join(home, '.aws'), join(home, '.config', 'gh')]) {
      assert.ok(specs[0]?.denyReadPaths.includes(denied), `denies reading ${denied}`);
    }
  });

  it('a read verb runs with no writable path', async () => {
    const real = locateGsdCore(process.env);
    assert.ok(real.ok);
    const s = staging();
    const specs: CommandSpec[] = [];
    const inner = new SandboxedExecutor();
    const adapter = new GsdOnboardingAdapter(real.value, {
      executor: {
        descriptor: inner.descriptor,
        run: (cmd, signal) => {
          specs.push(cmd);
          return inner.run(cmd, signal);
        },
      },
      dataRoot: join(s.base, 'data'),
      home: s.base,
    });
    const drift = await adapter.checkDrift(s.root);
    assert.equal(specs.length, 1);
    assert.deepEqual(specs[0]?.writePaths, []);
    void drift;
  });
});
