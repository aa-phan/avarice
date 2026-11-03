// The T3 live harness can run a host version that is not yet admitted (AVARICE_LIVE_ADMIT_CLAUDE_VERSION, plan 01-16
// follow-up for claude 2.1.317). Only the harness reads that variable: production code must not, and the admission list
// must not move because of it.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ADMITTED_CLAUDE_VERSIONS, checkHostReady } from '../../src/adapters/host-claude/launch-preflight.ts';
import { ADMIT_ENV, admissionOverride, launchMarkerWrapperScript } from '../helpers/live-harness.ts';

const REPO = join(import.meta.dirname, '..', '..');
const PROBE_OK = ['/usr/bin/true'] as const;
let root = '';
let hook = '';
let counter = 0;

before(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-admit-override-')));
  hook = join(root, 'hook.ts');
  writeFileSync(hook, '// hook\n');
});
after(() => rmSync(root, { recursive: true, force: true }));

// A stand-in "real" host that reports a version and, for any other argument, writes a line to a marker.
function fakeReal(version: string): { bin: string; ran: string } {
  const dir = join(root, `real-${counter++}`);
  const bin = join(dir, 'claude');
  const ran = join(dir, 'ran-with');
  mkdirSync(dir, { recursive: true });
  writeFileSync(bin, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${version} (Claude Code)"; exit 0; fi\necho "$@" > '${ran}'\nexit 0\n`);
  chmodSync(bin, 0o755);
  return { bin, ran };
}

function wrapped(real: string, version: string, env: NodeJS.ProcessEnv): string {
  const dir = join(root, `wrap-${counter++}`);
  mkdirSync(dir, { recursive: true });
  const bin = join(dir, 'claude-marker');
  writeFileSync(bin, launchMarkerWrapperScript(real, join(dir, 'marker'), admissionOverride(version, env)));
  chmodSync(bin, 0o755);
  return bin;
}

const ready = (bin: string) => checkHostReady({ claudeBin: bin, hookEntry: hook, sandboxProbe: PROBE_OK });

describe('the live harness admission override', () => {
  it('does nothing unless the environment variable names the version the real binary reports', () => {
    assert.equal(admissionOverride('2.1.317', {}), undefined);
    assert.equal(admissionOverride('2.1.317', { [ADMIT_ENV]: '' }), undefined);
    assert.equal(admissionOverride('2.1.317', { [ADMIT_ENV]: '2.1.400' }), undefined);
    assert.equal(admissionOverride('2.1.400', { [ADMIT_ENV]: '2.1.317' }), undefined);
    assert.deepEqual(admissionOverride('2.1.317', { [ADMIT_ENV]: '2.1.317' }), { reported: '2.1.317', as: ADMITTED_CLAUDE_VERSIONS[ADMITTED_CLAUDE_VERSIONS.length - 1] });
  });

  it('is not needed for a version that is already admitted', () => {
    for (const v of ADMITTED_CLAUDE_VERSIONS) assert.equal(admissionOverride(v, { [ADMIT_ENV]: v }), undefined);
  });

  it('lets the harness wrapper pass the preflight for the named version only, and runs the real binary for everything else', () => {
    const real = fakeReal('2.1.317');
    const env = { [ADMIT_ENV]: '2.1.317' };
    assert.ok(ready(wrapped(real.bin, '2.1.317', env)).ok);
    const bin = wrapped(real.bin, '2.1.317', env);
    spawnSync(bin, ['-p', 'hello']);
    assert.equal(readFileSync(real.ran, 'utf8').trim(), '-p hello');
    const other = fakeReal('2.1.400');
    const refused = ready(wrapped(other.bin, '2.1.400', env));
    assert.ok(!refused.ok);
    assert.equal(refused.ok ? '' : refused.error.kind === 'denied' ? refused.error.rule : '', 'enforcement_failure:host-version-not-admitted:2.1.400');
  });

  it('is ignored by production: with the variable set the preflight still refuses an unadmitted version, and no source file reads it', () => {
    const saved = process.env[ADMIT_ENV];
    process.env[ADMIT_ENV] = '2.1.317';
    try {
      const real = fakeReal('2.1.317');
      const result = ready(real.bin);
      assert.ok(!result.ok);
      assert.equal(result.ok ? '' : result.error.kind === 'denied' ? result.error.rule : '', 'enforcement_failure:host-version-not-admitted:2.1.317');
    } finally {
      if (saved === undefined) delete process.env[ADMIT_ENV];
      else process.env[ADMIT_ENV] = saved;
    }
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
    for (const file of [...walk(join(REPO, 'src')), ...walk(join(REPO, 'bin'))]) assert.ok(!readFileSync(file, 'utf8').includes('ADMIT_CLAUDE_VERSION'), `${file} must not read the live-harness admission variable`);
  });
});
