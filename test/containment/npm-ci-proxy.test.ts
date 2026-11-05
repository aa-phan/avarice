// Plan 02-06 Task 3, spike S2-C (RESEARCH assumption A1, D-11): `npm ci --ignore-scripts` on a scratch clone of the portfolio at
// 9f1cd8d, run under SandboxedExecutor with network only to the allowlist proxy port, the proxy admitting only
// registry.npmjs.org:443. Skipped unless AVARICE_NET=1 (it needs the real registry). The owner's checkout is only read by
// `git clone`; everything else happens in a temp directory.
//   AVARICE_NET=1 node --test test/containment/npm-ci-proxy.test.ts
//   AVARICE_S2C_REPO   path of the portfolio checkout (default $HOME/aa-phan-portfolio-v2)
//   AVARICE_S2C_REPORT optional path; the test writes its evidence (JSON) there for the spike record
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { SandboxedExecutor } from '../../src/adapters/exec/sandboxed-executor.ts';
import { startAllowlistProxy } from '../../src/adapters/exec/allowlist-proxy.ts';

const PIN = '9f1cd8d';
const REGISTRY = 'registry.npmjs.org';
const NET = process.env['AVARICE_NET'] === '1';
const SANDBOX_AVAILABLE = existsSync('/usr/bin/sandbox-exec');
const SOURCE = process.env['AVARICE_S2C_REPO'] ?? join(homedir(), 'aa-phan-portfolio-v2');
const skip = !NET ? 'needs network to registry.npmjs.org (set AVARICE_NET=1)' : !SANDBOX_AVAILABLE ? 'needs /usr/bin/sandbox-exec' : false;

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string | undefined, args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function lockfileHosts(lockPath: string): Record<string, number> {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as { packages?: Record<string, { resolved?: string; link?: boolean }> };
  const hosts: Record<string, number> = {};
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (key === '') continue;
    const host = entry.resolved === undefined ? (entry.link === true ? '(workspace link)' : '(no resolved url)') : new URL(entry.resolved).host;
    hosts[host] = (hosts[host] ?? 0) + 1;
  }
  return hosts;
}

describe('S2-C: npm ci --ignore-scripts through the sandbox and the allowlist proxy', { skip }, () => {
  it('installs the portfolio lockfile with network only to the proxy and the registry as the only allowed host', { timeout: 900_000 }, async () => {
    const sourceStatusBefore = git(SOURCE, ['status', '--porcelain']);
    const sourceHeadBefore = git(SOURCE, ['rev-parse', 'HEAD']).trim();

    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-s2c-')));
    cleanup.push(tmp);
    const clone = join(tmp, 'clone');
    for (const dir of ['home', 'tmp', 'npm-cache']) mkdirSync(join(tmp, dir));
    git(undefined, ['clone', '--quiet', '--no-hardlinks', SOURCE, clone]);
    git(clone, ['-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--detach', PIN]);
    assert.ok(git(clone, ['rev-parse', 'HEAD']).startsWith(PIN), 'the clone is at the pin');

    const hosts = lockfileHosts(join(clone, 'package-lock.json'));
    const outside = Object.keys(hosts).filter((h) => h !== REGISTRY);
    const report: Record<string, unknown> = { date: new Date().toISOString(), pin: PIN, node: process.version, lockfileHosts: hosts, sourceStatusBefore, sourceHeadBefore };
    const writeReport = (): void => {
      const path = process.env['AVARICE_S2C_REPORT'];
      if (path !== undefined && path.length > 0) writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
    };
    // A host outside the registry is a recorded failure, not a silent pass.
    assert.deepEqual(outside, [], `lockfile resolved URLs outside ${REGISTRY}: ${JSON.stringify(hosts)}`);

    const path = `${dirname(process.execPath)}:/usr/bin:/bin`;
    const npmVersion = spawnSync('npm', ['--version'], { encoding: 'utf8', env: { PATH: path, HOME: join(tmp, 'home') } }).stdout.trim();
    report['npm'] = npmVersion;

    const proxy = await startAllowlistProxy({ allow: [`${REGISTRY}:443`] });
    assert.ok(proxy.ok, JSON.stringify(proxy));
    try {
      const proxyUrl = `http://127.0.0.1:${proxy.value.port}`;
      const home = homedir();
      const started = Date.now();
      const result = await new SandboxedExecutor().run({
        argv: ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
        cwd: clone,
        env: {
          PATH: path,
          HOME: join(tmp, 'home'),
          TMPDIR: join(tmp, 'tmp'),
          npm_config_cache: join(tmp, 'npm-cache'),
          npm_config_https_proxy: proxyUrl,
          npm_config_proxy: proxyUrl,
          npm_config_update_notifier: 'false',
          CI: '1',
        },
        timeoutMs: 600_000,
        invocationId: 's2c',
        writePaths: [join(clone, 'node_modules'), tmp],
        denyReadPaths: [join(home, '.ssh'), join(home, '.aws'), join(home, '.config', 'gh')],
        allowLoopbackPorts: [proxy.value.port],
      });
      report['wallMs'] = Date.now() - started;
      const attempts = proxy.value.attempts();
      const counts: Record<string, number> = {};
      for (const a of attempts) {
        const key = `${a.host}:${a.port} ${a.allowed ? 'allowed' : 'refused'}`;
        counts[key] = (counts[key] ?? 0) + 1;
      }
      report['attempts'] = counts;
      report['result'] = result.ok ? { status: result.value.status, exitCode: result.value.exitCode, signal: result.value.signal, stdoutTail: result.value.stdout.slice(-600), stderrTail: result.value.stderr.slice(-1500) } : result.error;
      const du = spawnSync('du', ['-sk', join(clone, 'node_modules')], { encoding: 'utf8' });
      report['nodeModulesKiB'] = Number(du.stdout.split('\t')[0]);
      report['sourceStatusAfter'] = git(SOURCE, ['status', '--porcelain']);
      report['sourceHeadAfter'] = git(SOURCE, ['rev-parse', 'HEAD']).trim();
      writeReport();

      assert.ok(result.ok, JSON.stringify(result));
      assert.equal(result.value.exitCode, 0, `npm ci exited ${String(result.value.exitCode)}: ${result.value.stderr.slice(-1500)}`);
      assert.ok(existsSync(join(clone, 'node_modules', '.package-lock.json')), 'node_modules/.package-lock.json exists');
      assert.ok(attempts.length > 0, 'the proxy was used: npm honoured the proxy settings');
      assert.deepEqual(attempts.filter((a) => !a.allowed), [], 'the proxy saw only allowed attempts');
      assert.deepEqual([...new Set(attempts.map((a) => `${a.host}:${a.port}`))], [`${REGISTRY}:443`]);
      assert.equal(report['sourceStatusAfter'], sourceStatusBefore, "the owner's checkout status is unchanged");
      assert.equal(report['sourceHeadAfter'], sourceHeadBefore, "the owner's checkout HEAD is unchanged");
    } finally {
      await proxy.value.close();
    }
  });
  it('controls: the sandbox gives no direct route and the proxy refuses any other host, even for a real client', { timeout: 60_000 }, async () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-s2c-ctl-')));
    cleanup.push(tmp);
    const proxy = await startAllowlistProxy({ allow: [`${REGISTRY}:443`] });
    assert.ok(proxy.ok, JSON.stringify(proxy));
    try {
      const executor = new SandboxedExecutor();
      const env = { PATH: '/usr/bin:/bin', HOME: tmp, LANG: 'C' };
      const base = { cwd: tmp, env, timeoutMs: 30_000, invocationId: 's2c-control', writePaths: [], denyReadPaths: [], allowLoopbackPorts: [proxy.value.port] };
      // Direct to the registry, ignoring the proxy: Seatbelt denies the connection.
      const direct = await executor.run({ ...base, argv: ['curl', '-sS', '--noproxy', '*', '--max-time', '10', `https://${REGISTRY}/`] });
      assert.ok(direct.ok);
      assert.notEqual(direct.value.exitCode, 0, 'a direct connection must fail');
      assert.equal(proxy.value.attempts().length, 0, 'the direct attempt never reached the proxy');
      // Through the proxy to a host that is not on the allowlist: refused with 403.
      const other = await executor.run({ ...base, argv: ['curl', '-sS', '--max-time', '10', '-x', `http://127.0.0.1:${proxy.value.port}`, 'https://example.com/'] });
      assert.ok(other.ok);
      assert.notEqual(other.value.exitCode, 0, 'a CONNECT to another host must fail');
      assert.deepEqual(proxy.value.attempts().map((a) => ({ host: a.host, port: a.port, allowed: a.allowed })), [{ host: 'example.com', port: 443, allowed: false }]);
    } finally {
      await proxy.value.close();
    }
  });
});
