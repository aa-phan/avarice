// Host admission by patch range with a launch self-check (D-20, OPS-6; docs/decisions/ADR-014-host-patch-admission.md).
// The predicate is pure; the preflight tests use fake `claude` binaries that answer --version and --help and leave a marker.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  REQUIRED_HELP_FLAGS,
  VERIFIED_HOST_VERSIONS,
  VERIFIED_MINORS,
  admitHostVersion,
  compareVersions,
} from '../../src/domain/host-admission.ts';
import { ClaudeHostAdapter } from '../../src/adapters/host-claude/claude-host.ts';
import type { ClaudeHostOptions } from '../../src/adapters/host-claude/claude-host.ts';
import { ADMITTED_CLAUDE_VERSIONS, checkHostReady, checkLaunchReady } from '../../src/adapters/host-claude/launch-preflight.ts';

const PROBE_OK = ['/usr/bin/true'] as const;
let root = '';
let hookScript = '';
let counter = 0;

before(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-host-admission-')));
  hookScript = join(root, 'pre-tool-use.ts');
  writeFileSync(hookScript, '// hook entry\n');
});
after(() => rmSync(root, { recursive: true, force: true }));

function fresh(name: string): string {
  const dir = join(root, `${name}-${counter++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface FakeHost {
  bin: string;
  versionMarker: string;
  helpMarker: string;
}

// A fake `claude`: --version prints the version, --help prints one line per flag given; each leaves its own marker.
function fakeHost(version: string, helpFlags: readonly string[] = REQUIRED_HELP_FLAGS): FakeHost {
  const dir = fresh('claude');
  const versionMarker = join(dir, 'version-ran');
  const helpMarker = join(dir, 'help-ran');
  const bin = join(dir, 'claude');
  const help = helpFlags.map((flag) => `  ${flag} <value>  What ${flag} does`).join('\\n');
  writeFileSync(
    bin,
    `#!/bin/sh\nif [ "$1" = "--version" ]; then echo ran > "${versionMarker}"; echo "${version} (Claude Code)"; exit 0; fi\n` +
      `if [ "$1" = "--help" ]; then echo ran > "${helpMarker}"; printf 'Usage: claude [options]\\n${help}\\n'; exit 0; fi\nexit 9\n`,
  );
  chmodSync(bin, 0o755);
  return { bin, versionMarker, helpMarker };
}

function rule(result: ReturnType<typeof checkHostReady>): string {
  assert.ok(!result.ok, 'expected a refusal');
  assert.ok(result.error.kind === 'denied', JSON.stringify(result));
  return result.error.kind === 'denied' ? result.error.rule : '';
}

const ready = (bin: string) => checkHostReady({ claudeBin: bin, hookEntry: hookScript, sandboxProbe: PROBE_OK });

describe('admitHostVersion', () => {
  it('verifies every version in the verified list', () => {
    assert.deepEqual([...VERIFIED_HOST_VERSIONS], ['2.1.312', '2.1.316', '2.1.317', '2.1.318', '2.1.319', '2.1.326']);
    for (const version of VERIFIED_HOST_VERSIONS) assert.deepEqual(admitHostVersion(version), { admission: 'verified' });
  });

  it('keeps ADMITTED_CLAUDE_VERSIONS as an alias of the verified list for existing importers', () => {
    assert.deepEqual([...ADMITTED_CLAUDE_VERSIONS], [...VERIFIED_HOST_VERSIONS]);
  });

  it('marks a 2.1 patch at or above 2.1.312 that is not in the list as an unverified patch', () => {
    assert.equal(VERIFIED_MINORS['2.1'], 312);
    for (const version of ['2.1.313', '2.1.320', '2.1.325', '2.1.330', '2.1.1000']) {
      assert.deepEqual(admitHostVersion(version), { admission: 'unverified-patch' }, version);
    }
  });

  it('refuses any other minor, whatever its patch', () => {
    for (const version of ['2.2.0', '2.2.400', '2.0.500', '3.1.312', '1.1.312']) {
      assert.deepEqual(admitHostVersion(version), { refused: 'host-minor-unverified' }, version);
    }
  });

  it('refuses a patch below the lowest verified patch of the minor', () => {
    for (const version of ['2.1.311', '2.1.40', '2.1.0', '2.1.99']) {
      assert.deepEqual(admitHostVersion(version), { refused: 'host-patch-below-range' }, version);
    }
  });

  it('refuses an empty, partial or non-numeric version as unknown', () => {
    for (const version of ['', '  ', '2.1', '2.1.x', 'v2.1.320', '2.1.320-beta', '2.1.320.1', 'latest', '2..320', '-2.1.320']) {
      assert.deepEqual(admitHostVersion(version), { refused: 'host-version-unknown' }, JSON.stringify(version));
    }
  });
});

describe('compareVersions orders each component as a number (OPS-6, T-04-29)', () => {
  it('puts 2.1.100 above 2.1.99 and 2.1.312 above 2.1.40, where a text comparison reverses both', () => {
    assert.ok(compareVersions('2.1.100', '2.1.99') > 0);
    assert.ok(compareVersions('2.1.99', '2.1.100') < 0);
    assert.ok(compareVersions('2.1.312', '2.1.40') > 0);
    assert.ok(compareVersions('2.10.0', '2.9.9') > 0);
    assert.ok(compareVersions('10.0.0', '9.9.9') > 0);
  });

  it('is zero for equal versions, whatever their zero padding', () => {
    assert.equal(compareVersions('2.1.312', '2.1.312'), 0);
    assert.equal(compareVersions('2.1.0312', '2.1.312'), 0);
  });

  it('is NaN when either side is not a version', () => {
    assert.ok(Number.isNaN(compareVersions('', '2.1.312')));
    assert.ok(Number.isNaN(compareVersions('2.1.312', 'abc')));
  });

  it('admits 2.1.1000 as a later patch, not as one below 2.1.312', () => {
    assert.deepEqual(admitHostVersion('2.1.1000'), { admission: 'unverified-patch' });
  });
});

describe('checkHostReady: an unverified patch launches only after its flag probe passes', () => {
  it('admits 2.1.330 as an unverified patch when --help lists every required flag', () => {
    const host = fakeHost('2.1.330');
    const result = ready(host.bin);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.ok && result.value.claudeVersion, '2.1.330');
    assert.equal(result.ok && result.value.admission, 'unverified-patch');
    assert.ok(existsSync(host.helpMarker), 'the help probe ran');
  });

  it('refuses it when --help omits --permission-prompts', () => {
    const host = fakeHost('2.1.330', REQUIRED_HELP_FLAGS.filter((flag) => flag !== '--permission-prompts'));
    assert.equal(rule(ready(host.bin)), 'enforcement_failure:host-flag-missing:--permission-prompts');
  });

  it('names every required flag when it is the only one missing', () => {
    for (const missing of REQUIRED_HELP_FLAGS) {
      const host = fakeHost('2.1.330', REQUIRED_HELP_FLAGS.filter((flag) => flag !== missing));
      assert.equal(rule(ready(host.bin)), `enforcement_failure:host-flag-missing:${missing}`);
    }
  });

  it('does not take a flag that is a prefix of another as present (--settings is not --setting-sources)', () => {
    const host = fakeHost('2.1.330', [...REQUIRED_HELP_FLAGS.filter((flag) => flag !== '--settings'), '--settings-profile']);
    assert.equal(rule(ready(host.bin)), 'enforcement_failure:host-flag-missing:--settings');
  });

  it('refuses when --help cannot be read', () => {
    const dir = fresh('claude');
    const bin = join(dir, 'claude');
    writeFileSync(bin, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.330 (Claude Code)"; exit 0; fi\nexit 3\n');
    chmodSync(bin, 0o755);
    assert.equal(rule(ready(bin)), 'enforcement_failure:host-unavailable');
  });

  it('admits 2.1.319 as verified without running the help probe', () => {
    const host = fakeHost('2.1.319', []);
    const result = ready(host.bin);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.ok && result.value.admission, 'verified');
    assert.ok(!existsSync(host.helpMarker), 'a verified version is not probed');
  });

  it('refuses 2.2.0 as an unverified minor and 2.1.311 as below the range, without running the help probe', () => {
    const minor = fakeHost('2.2.0');
    assert.equal(rule(ready(minor.bin)), 'enforcement_failure:host-minor-unverified');
    assert.ok(!existsSync(minor.helpMarker));
    const below = fakeHost('2.1.311');
    assert.equal(rule(ready(below.bin)), 'enforcement_failure:host-patch-below-range');
    assert.ok(!existsSync(below.helpMarker));
  });

  it('still refuses an output that does not start with a version', () => {
    const dir = fresh('claude');
    const bin = join(dir, 'claude');
    writeFileSync(bin, '#!/bin/sh\necho hello\n');
    chmodSync(bin, 0o755);
    assert.equal(rule(ready(bin)), 'enforcement_failure:host-version-unreadable');
  });
});

// Settings that carry every required key and every AVARICE hook entry, with the pre hook pointing at a script that allows everything.
function settingsFor(hook: string): Record<string, unknown> {
  const entry = (event: string, onFailure: string) => ({ hooks: [{ command: process.execPath, args: [hook, '--event', event], onFailure }] });
  return {
    permissions: { defaultMode: 'dontAsk', disableBypassPermissionsMode: 'disable' },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: false,
      excludedCommands: [],
      network: { allowedDomains: [], strictAllowlist: true },
    },
    hooks: {
      PreToolUse: [entry('pre', 'block')],
      ConfigChange: [entry('config-change', 'block')],
      PostToolUse: [entry('post', 'block')],
      PostToolUseFailure: [entry('post', 'block')],
    },
  };
}

function launchInput(host: FakeHost, hook: string) {
  const dir = fresh('launch');
  const settingsFile = join(dir, 'host-settings.json');
  writeFileSync(settingsFile, JSON.stringify(settingsFor(hook)));
  const policyFile = join(dir, 'hook-policy.json');
  writeFileSync(policyFile, JSON.stringify({ stagingPath: dir }));
  return { settingsFile, policyFile, claudeBin: host.bin, sandboxProbe: PROBE_OK };
}

describe('checkLaunchReady: an unverified patch still has to pass the sandbox probe and the hook self-test', () => {
  it('refuses an unverified patch whose hook allows the synthetic write, naming hook-self-test, before the host runs', () => {
    const allowing = join(fresh('hook'), 'allow.mjs');
    writeFileSync(allowing, 'process.exit(0);\n');
    const host = fakeHost('2.1.330');
    const result = checkLaunchReady(launchInput(host, allowing));
    assert.equal(rule(result), 'enforcement_failure:hook-self-test');
    assert.ok(!existsSync(host.versionMarker), 'the host is not asked its version after a failed hook self-test');
    assert.ok(!existsSync(host.helpMarker));
  });

  it('refuses an unverified patch when the sandbox probe fails, naming sandbox-unavailable, before the help probe runs', () => {
    const host = fakeHost('2.1.330');
    const { settingsFile } = launchInput(host, hookScript);
    const result = checkLaunchReady({ settingsFile, claudeBin: host.bin, sandboxProbe: ['/usr/bin/false'] });
    assert.equal(rule(result), 'enforcement_failure:sandbox-unavailable');
    assert.ok(!existsSync(host.helpMarker), 'the help probe does not run after a failed sandbox probe');
  });

  it('admits an unverified patch with a passing settings check, sandbox probe and flag probe, and reports the admission', () => {
    const host = fakeHost('2.1.330');
    const { settingsFile } = launchInput(host, hookScript);
    const result = checkLaunchReady({ settingsFile, claudeBin: host.bin, sandboxProbe: PROBE_OK });
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.ok && result.value.admission, 'unverified-patch');
  });

  it('refuses an unverified patch whose --help omits a required flag at launch', () => {
    const host = fakeHost('2.1.330', REQUIRED_HELP_FLAGS.filter((flag) => flag !== '--max-budget-usd'));
    const { settingsFile } = launchInput(host, hookScript);
    const result = checkLaunchReady({ settingsFile, claudeBin: host.bin, sandboxProbe: PROBE_OK });
    assert.equal(rule(result), 'enforcement_failure:host-flag-missing:--max-budget-usd');
  });

  it('refuses an unverified minor at launch', () => {
    const host = fakeHost('2.2.0');
    const { settingsFile } = launchInput(host, hookScript);
    const result = checkLaunchReady({ settingsFile, claudeBin: host.bin, sandboxProbe: PROBE_OK });
    assert.equal(rule(result), 'enforcement_failure:host-minor-unverified');
  });
});

// Only claudeBin, hookEntry and sandboxProbe are read by the descriptor, so the other options are left out.
function adapterFor(bin: string): ClaudeHostAdapter {
  return new ClaudeHostAdapter({ claudeBin: bin, hookEntry: hookScript, sandboxProbe: PROBE_OK } as unknown as ClaudeHostOptions);
}

describe('the host descriptor carries the admission (D-20, OPS-6)', () => {
  it('has attributes.admission verified for a verified version', () => {
    const descriptor = adapterFor(fakeHost('2.1.319', []).bin).descriptor;
    assert.equal(descriptor.attributes?.['enforcement'], 'enforced');
    assert.equal(descriptor.attributes?.['claudeVersion'], '2.1.319');
    assert.equal(descriptor.attributes?.['admission'], 'verified');
    assert.equal(descriptor.capabilities['contained-invocation'], true);
  });

  it('has attributes.admission unverified-patch for an unverified patch that passes its flag probe', () => {
    const descriptor = adapterFor(fakeHost('2.1.325').bin).descriptor;
    assert.equal(descriptor.attributes?.['enforcement'], 'enforced');
    assert.equal(descriptor.attributes?.['claudeVersion'], '2.1.325');
    assert.equal(descriptor.attributes?.['admission'], 'unverified-patch');
  });

  it('has no admission and no contained invocation when the host is refused, and gives the reason', () => {
    const descriptor = adapterFor(fakeHost('2.2.0').bin).descriptor;
    assert.equal(descriptor.attributes?.['enforcement'], 'none');
    assert.equal(descriptor.attributes?.['reason'], 'enforcement_failure:host-minor-unverified');
    assert.equal(descriptor.attributes?.['admission'], undefined);
    assert.equal(descriptor.capabilities['contained-invocation'], false);
  });
});
