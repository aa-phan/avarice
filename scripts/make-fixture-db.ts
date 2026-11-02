// Builds a store through the real code and writes it as a single-file SQLite database, for use as a committed
// fixture that later migrations are tested against. It onboards a tiny generated repository with the fake
// host in a temp profile (no model, no network) and copies the resulting store with VACUUM INTO.
//
//   node scripts/make-fixture-db.ts <output.sqlite>
//
// The output holds rows in projects, onboardings, checkpoints, events, contracts and project_records. Paths
// inside it point into a temp directory that no longer exists; the fixture is data, not a working profile.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { main } from '../src/cli/main.ts';
import { FakeAgentHost } from '../test/helpers/fake-agent-host.ts';

const REQUIRED_TABLES = ['projects', 'onboardings', 'checkpoints', 'events', 'contracts', 'project_records'] as const;

function git(cwd: string, args: readonly string[]): void {
  execFileSync('git', [...args], {
    cwd,
    env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: tmpdir(), LANG: 'C', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    stdio: 'pipe',
  });
}

async function build(output: string): Promise<void> {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-fixture-')));
  try {
    const repo = join(base, 'repo');
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'README.md'), '# fixture\n');
    writeFileSync(join(repo, 'src', 'index.ts'), 'export const fixture = 1;\n');
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['add', '-A']);
    git(repo, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'root']);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      AVARICE_CONFIG_HOME: join(base, 'config'),
      AVARICE_DATA_ROOT: join(base, 'data'),
      AVARICE_WORK_ROOT: join(base, 'work'),
    };
    let log = '';
    const io = { out: (t: string) => void (log += t), err: (t: string) => void (log += t) };
    const code = await main(['onboard', '--policy', 'onboarding', repo], { env, io, host: new FakeAgentHost() });
    if (code !== 0) throw new Error(`onboarding the fixture repository exited ${code}: ${log}`);

    const source = new DatabaseSync(join(base, 'data', 'state.db'), { readOnly: true });
    try {
      for (const table of REQUIRED_TABLES) {
        const row = source.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
        if (row.n === 0) throw new Error(`the fixture store has no rows in ${table}`);
      }
      mkdirSync(dirname(output), { recursive: true });
      if (existsSync(output)) rmSync(output);
      // VACUUM INTO writes a self-contained file with no -wal or -shm companions.
      source.prepare('VACUUM INTO ?').run(output);
    } finally {
      source.close();
    }
    chmodSync(output, 0o644);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

const target = process.argv[2];
if (target === undefined || process.argv.length !== 3) {
  process.stderr.write('usage: node scripts/make-fixture-db.ts <output.sqlite>\n');
  process.exitCode = 64;
} else {
  await build(resolve(target));
}
