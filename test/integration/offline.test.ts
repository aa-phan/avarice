// NFR-2: the onboarding slice runs with no network. Every command here runs under `sandbox-exec` with
// `(deny network*)`: onboarding with the fake host, `status`, and a kill-then-resume cycle that re-runs mapping,
// validation and planning. A control proves the wrapper really denies network, so a pass means something.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { OFFLINE_EXPIRY_WAIT_MS, offlineAvailable, offlineWrap, runOffline } from '../helpers/offline.ts';
import { PRODUCTION_ENTRY, makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const run = promisify(execFile);
const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const REPO_FILES = {
  'README.md': '# scratch\n',
  'package.json': '{"name":"scratch"}\n',
  'src/index.ts': 'export const answer = 42;\n',
  'docs/guide.md': '# guide\n',
};

function fixture(): { roots: CliRoots; repo: ScratchRepo } {
  const roots = makeRoots();
  const repo = makeScratchRepo({ files: REPO_FILES });
  cleanup.push(roots.base, repo.base);
  return { roots, repo };
}

function onboardingId(roots: CliRoots): string {
  const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
  try {
    return String((db.prepare('SELECT onboarding_id FROM onboardings').get() as { onboarding_id: string }).onboarding_id);
  } finally {
    db.close();
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

interface StatusEntry {
  state: string;
  recordVersion: number | null;
  interrupted?: unknown;
}

describe('the sandbox wrapper denies network (control)', { skip: !offlineAvailable() }, () => {
  it('lets curl reach a local server outside the wrapper and blocks it inside', async () => {
    const server = createServer((_req, res) => res.end('reachable'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    try {
      const open = await run('/usr/bin/curl', ['-sS', '--noproxy', '*', '--max-time', '5', url]);
      assert.equal(open.stdout, 'reachable', 'the server is reachable without the wrapper');
      const [wrapper, ...wrapArgs] = offlineWrap() as [string, ...string[]];
      await assert.rejects(run(wrapper, [...wrapArgs, '/usr/bin/curl', '-sS', '--noproxy', '*', '--max-time', '5', url]), (e: { code?: number; stdout?: string }) => {
        assert.notEqual(e.code, 0);
        assert.notEqual(e.stdout, 'reachable');
        return true;
      });
    } finally {
      server.close();
    }
  });
});

describe('the onboarding slice runs with the network denied (NFR-2)', { skip: !offlineAvailable() }, () => {
  it('onboards a scratch repository with the fake host and reads it back with status --json', () => {
    const { roots, repo } = fixture();
    const onboarded = runOffline(['onboard', '--policy', 'onboarding', repo.path], { roots });
    assert.equal(onboarded.code, 0, onboarded.stderr + onboarded.stdout);
    assert.match(onboarded.stdout, /onboarding onb_[0-9A-Z]{26}: active/);

    // The production entry (no fake host) reads the same profile.
    const status = runOffline(['status', '--json'], { roots, entry: PRODUCTION_ENTRY });
    assert.equal(status.code, 0, status.stderr);
    const entries = JSON.parse(status.stdout) as StatusEntry[];
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.state, 'active');
    assert.equal(entries[0]?.recordVersion, 1);
  });

  for (const [point, what] of [
    ['after-transition:mapping', 'mapping is re-run'],
    ['after-transition:validating', 'validation is re-run'],
    ['after-transition:planning_ready', 'planning is resumed'],
  ] as const) {
    it(`killed at ${point}, resume finishes offline (${what}) and the project is active`, () => {
      const { roots, repo } = fixture();
      const killed = runOffline(['onboard', '--policy', 'onboarding', repo.path], { roots, env: { AVARICE_FAULT: point } });
      assert.equal(killed.signal, 'SIGKILL', `${killed.stdout}${killed.stderr}`);
      const id = onboardingId(roots);

      sleepSync(OFFLINE_EXPIRY_WAIT_MS);
      const interrupted = runOffline(['status', '--json'], { roots, entry: PRODUCTION_ENTRY });
      assert.equal(interrupted.code, 0, interrupted.stderr);
      assert.notEqual((JSON.parse(interrupted.stdout) as StatusEntry[])[0]?.state, 'active');
      assert.ok((JSON.parse(interrupted.stdout) as StatusEntry[])[0]?.interrupted, 'status shows the interruption offline');

      const resumed = runOffline(['resume', id], { roots });
      assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
      assert.match(resumed.stdout, new RegExp(`onboarding ${id}: active`));

      const after = runOffline(['status', '--json'], { roots, entry: PRODUCTION_ENTRY });
      assert.equal(after.code, 0, after.stderr);
      const [entry] = JSON.parse(after.stdout) as StatusEntry[];
      assert.equal(entry?.state, 'active');
      assert.equal(entry?.recordVersion, 1);
    });
  }

  it('runs init and status offline on a fresh profile with the production entry', () => {
    const roots = makeRoots();
    cleanup.push(roots.base);
    const init = runOffline(['init'], { roots, entry: PRODUCTION_ENTRY });
    assert.equal(init.code, 0, init.stderr);
    const status = runOffline(['status'], { roots, entry: PRODUCTION_ENTRY });
    assert.equal(status.code, 0, status.stderr);
    assert.match(status.stdout, /No projects registered/);
  });
});
