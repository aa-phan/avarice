import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Result } from '../../src/domain/result.ts';
import {
  CHECK_NAME_PATTERN,
  REFUSED_AGENT_COMMAND_WORDS,
  RESERVED_CHECK_ENV,
  checkSpecDigest,
  parseConventions,
} from '../../src/domain/conventions.ts';
import type { Conventions } from '../../src/domain/conventions.ts';

type Obj = Record<string, unknown>;

const VALID: Obj = {
  schema: 1,
  checks: [
    { name: 'typecheck', argv: ['npm', 'run', 'typecheck'], timeoutSec: 300, env: { VITE_SITE_ORIGIN: 'https-example' }, writes: ['node_modules/.tmp/**'] },
    { name: 'test', argv: ['npm', 'test'], required: true },
    { name: 'e2e', argv: ['npm', 'run', 'test:e2e'], required: false, timeoutSec: 1200 },
  ],
  paths: { write: ['src/**', 'test/**'], protected: ['test/fixtures/**'], artifacts: ['dist/**'] },
  testInventory: { argv: ['npm', 'test', '--', '--list'], globs: ['test/**/*.test.ts'] },
  dependencies: { install: ['npm', 'ci', '--ignore-scripts'], lockfile: 'package-lock.json', registryHosts: ['registry-host.example'] },
  agentCommands: ['npm test', 'npx tsc --noEmit <paths>'],
};

function parse(value: unknown): Result<Conventions> {
  return parseConventions(typeof value === 'string' ? value : JSON.stringify(value));
}

function unwrap(r: Result<Conventions>): Conventions {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
}

function refusedField(r: Result<Conventions>): string {
  assert.equal(r.ok, false, 'expected a refusal');
  if (r.ok) throw new Error('unreachable');
  assert.equal(r.error.kind, 'invalid');
  return (r.error as { field: string }).field;
}

function withCheck(patch: Obj): Obj {
  return { schema: 1, checks: [{ name: 'test', argv: ['npm', 'test'], ...patch }] };
}

function withPaths(paths: Obj): Obj {
  return { schema: 1, checks: [], paths };
}

describe('parseConventions: a well-formed file', () => {
  it('parses schema 1 and applies the defaults: timeoutSec 600, required true, empty env and writes', () => {
    const conventions = unwrap(parse(VALID));
    assert.equal(conventions.schema, 1);
    assert.equal(conventions.checks.length, 3);
    const test = conventions.checks[1];
    assert.deepEqual(test, { name: 'test', argv: ['npm', 'test'], timeoutSec: 600, required: true, env: {}, writes: [] });
    assert.deepEqual(conventions.checks[0]?.env, { VITE_SITE_ORIGIN: 'https-example' });
    assert.equal(conventions.checks[2]?.required, false);
    assert.deepEqual(conventions.paths, { write: ['src/**', 'test/**'], protected: ['test/fixtures/**'], artifacts: ['dist/**'] });
    assert.deepEqual(conventions.testInventory, { argv: ['npm', 'test', '--', '--list'], globs: ['test/**/*.test.ts'] });
    assert.deepEqual(conventions.dependencies, VALID.dependencies);
    assert.deepEqual(conventions.agentCommands, ['npm test', 'npx tsc --noEmit <paths>']);
  });

  it('parses a minimal file: only the schema gives no checks, empty paths and no optional sections', () => {
    const conventions = unwrap(parse({ schema: 1 }));
    assert.deepEqual(conventions.checks, []);
    assert.deepEqual(conventions.paths, { write: [], protected: [], artifacts: [] });
    assert.equal(conventions.testInventory, undefined);
    assert.equal(conventions.dependencies, undefined);
    assert.deepEqual(conventions.agentCommands, []);
  });

  it('gives the same result for two texts that differ only in JSON key order', () => {
    const reordered = JSON.stringify(VALID, (_key, value: unknown) =>
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value as Obj).reverse())
        : value,
    );
    assert.notEqual(reordered, JSON.stringify(VALID));
    assert.deepEqual(unwrap(parse(reordered)), unwrap(parse(VALID)));
  });
});

describe('parseConventions: structure and unknown keys', () => {
  it('refuses text that is not JSON, or not an object, with field conventions', () => {
    assert.equal(refusedField(parse('{ not json')), 'conventions');
    assert.equal(refusedField(parse('[]')), 'conventions');
    assert.equal(refusedField(parse('null')), 'conventions');
    assert.equal(refusedField(parse('"x"')), 'conventions');
  });

  it('refuses text over 256 KiB with field conventions', () => {
    const big = JSON.stringify({ schema: 1, agentCommands: [], note: 'x'.repeat(262144) });
    assert.equal(refusedField(parse(big)), 'conventions');
  });

  it('refuses a schema other than 1 with field conventions.schema', () => {
    for (const schema of [0, 2, '1', null, undefined]) {
      assert.equal(refusedField(parse({ schema, checks: [] })), 'conventions.schema', String(schema));
    }
  });

  it('refuses an unknown key at every level, naming it', () => {
    assert.equal(refusedField(parse({ schema: 1, extra: true })), 'conventions.extra');
    assert.equal(refusedField(parse(withCheck({ retries: 3 }))), 'conventions.checks[0].retries');
    assert.equal(refusedField(parse(withPaths({ read: ['x'] }))), 'conventions.paths.read');
    assert.equal(refusedField(parse({ schema: 1, testInventory: { globs: [], runner: 'x' } })), 'conventions.testInventory.runner');
    assert.equal(
      refusedField(parse({ schema: 1, dependencies: { install: ['npm', 'ci'], lockfile: 'package-lock.json', registryHosts: [], proxy: 'x' } })),
      'conventions.dependencies.proxy',
    );
    assert.equal(refusedField(parse('{"schema":1,"__proto__":{"x":1}}')), 'conventions.__proto__');
  });
});

describe('parseConventions: checks', () => {
  it('refuses a duplicate check name with field conventions.checks[1].name', () => {
    const value = { schema: 1, checks: [{ name: 'test', argv: ['a'] }, { name: 'test', argv: ['b'] }] };
    assert.equal(refusedField(parse(value)), 'conventions.checks[1].name');
  });

  it('refuses a check name not matching [a-z][a-z0-9:_-]{0,63} with field conventions.checks[0].name', () => {
    for (const name of ['Test', '1x', '', 'a b', 'a.b', 'x'.repeat(65), 'é', '-x']) {
      assert.equal(refusedField(parse(withCheck({ name }))), 'conventions.checks[0].name', JSON.stringify(name));
    }
    for (const name of ['test', 'check:meta', 'test_e2e', 'a-b', 'x'.repeat(64)]) {
      assert.ok(CHECK_NAME_PATTERN.test(name), name);
      unwrap(parse(withCheck({ name })));
    }
    assert.equal(refusedField(parse(withCheck({ name: 5 }))), 'conventions.checks[0].name');
  });

  it('refuses an empty argv, a non-string word, a word with NUL, an oversized word with field conventions.checks[0].argv', () => {
    for (const argv of [[], 'npm test', ['npm', 5], ['npm', 'te\u0000st'], ['x'.repeat(1025)], undefined]) {
      assert.equal(refusedField(parse(withCheck({ argv }))), 'conventions.checks[0].argv', JSON.stringify(argv));
    }
    assert.equal(refusedField(parse(withCheck({ argv: ['a', ''] }))), 'conventions.checks[0].argv');
  });

  it('refuses more than 32 checks with field conventions.checks, and accepts 32', () => {
    const checks = (n: number): unknown[] => Array.from({ length: n }, (_, i) => ({ name: `check${i}`, argv: ['x'] }));
    assert.equal(refusedField(parse({ schema: 1, checks: checks(33) })), 'conventions.checks');
    assert.equal(unwrap(parse({ schema: 1, checks: checks(32) })).checks.length, 32);
    assert.equal(refusedField(parse({ schema: 1, checks: 'x' })), 'conventions.checks');
  });

  it('refuses a timeoutSec outside 1..3600 or not an integer with field conventions.checks[0].timeoutSec', () => {
    for (const timeoutSec of [0, -1, 3601, 1.5, '30', null, Number.MAX_SAFE_INTEGER]) {
      assert.equal(refusedField(parse(withCheck({ timeoutSec }))), 'conventions.checks[0].timeoutSec', String(timeoutSec));
    }
    assert.equal(unwrap(parse(withCheck({ timeoutSec: 1 }))).checks[0]?.timeoutSec, 1);
    assert.equal(unwrap(parse(withCheck({ timeoutSec: 3600 }))).checks[0]?.timeoutSec, 3600);
  });

  it('refuses a non-boolean required with field conventions.checks[0].required', () => {
    assert.equal(refusedField(parse(withCheck({ required: 'yes' }))), 'conventions.checks[0].required');
    assert.equal(refusedField(parse(withCheck({ required: 1 }))), 'conventions.checks[0].required');
  });

  it('refuses an env key not matching [A-Z_][A-Z0-9_]* or a non-string value with field conventions.checks[0].env', () => {
    for (const env of [{ lower: 'x' }, { '1BAD': 'x' }, { 'A-B': 'x' }, { GOOD: 5 }, { GOOD: 'a\u0000b' }, ['x'], 'x']) {
      assert.equal(refusedField(parse(withCheck({ env }))), 'conventions.checks[0].env', JSON.stringify(env));
    }
    assert.deepEqual(unwrap(parse(withCheck({ env: { VITE_SITE_ORIGIN: 'a', _X1: 'b' } }))).checks[0]?.env, { VITE_SITE_ORIGIN: 'a', _X1: 'b' });
  });

  it('refuses a reserved env key (PATH, HOME, TMPDIR, NODE_OPTIONS, DYLD_*, LD_*, npm_config_*) with field conventions.checks[0].env', () => {
    const reserved = ['PATH', 'HOME', 'TMPDIR', 'NODE_OPTIONS', 'DYLD_INSERT_LIBRARIES', 'DYLD_X', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'npm_config_cache', 'NPM_CONFIG_REGISTRY'];
    for (const key of reserved) {
      assert.equal(refusedField(parse(withCheck({ env: { [key]: 'x' } }))), 'conventions.checks[0].env', key);
    }
    for (const key of ['PATH', 'HOME', 'TMPDIR', 'NODE_OPTIONS']) assert.ok(RESERVED_CHECK_ENV.includes(key), key);
  });

  it('refuses unsafe check writes globs with field conventions.checks[0].writes', () => {
    for (const writes of [['/abs'], ['../x'], ['a\\b'], ['a\u0000b'], [''], 'dist', [5]]) {
      assert.equal(refusedField(parse(withCheck({ writes }))), 'conventions.checks[0].writes', JSON.stringify(writes));
    }
  });
});

describe('parseConventions: paths, inventory, dependencies and agent commands', () => {
  it('refuses a glob that is absolute, contains .. , a backslash or NUL, or is empty, in each path list', () => {
    for (const list of ['write', 'protected', 'artifacts']) {
      for (const glob of ['/etc/**', '../x', 'src/../x', 'a\\b', 'a\u0000b', '', '~/x', 'src//x', './x', 'x'.repeat(513)]) {
        assert.equal(refusedField(parse(withPaths({ [list]: [glob] }))), `conventions.paths.${list}`, `${list} ${JSON.stringify(glob)}`);
      }
      assert.equal(refusedField(parse(withPaths({ [list]: 'src/**' }))), `conventions.paths.${list}`);
    }
  });

  it('refuses a testInventory without globs, and dependencies with a bad lockfile or host, naming the field', () => {
    assert.equal(refusedField(parse({ schema: 1, testInventory: { argv: ['x'] } })), 'conventions.testInventory.globs');
    assert.equal(refusedField(parse({ schema: 1, testInventory: { argv: [], globs: [] } })), 'conventions.testInventory.argv');
    const deps = (patch: Obj): Obj => ({ schema: 1, dependencies: { install: ['npm', 'ci'], lockfile: 'package-lock.json', registryHosts: [], ...patch } });
    assert.equal(refusedField(parse(deps({ lockfile: '/abs/lock' }))), 'conventions.dependencies.lockfile');
    assert.equal(refusedField(parse(deps({ install: [] }))), 'conventions.dependencies.install');
    for (const host of ['host/path', 'host:443', 'HTTP://x', 'bad host', '', '-x.example', '*.example']) {
      assert.equal(refusedField(parse(deps({ registryHosts: [host] }))), 'conventions.dependencies.registryHosts', host);
    }
    assert.deepEqual(unwrap(parse(deps({ registryHosts: ['127.0.0.1', 'a.b-c.example'] }))).dependencies?.registryHosts, ['127.0.0.1', 'a.b-c.example']);
  });

  it('refuses an agent command whose first word is git, avarice, claude, gh, curl, wget, ssh, scp or sudo', () => {
    for (const word of ['git', 'avarice', 'claude', 'gh', 'curl', 'wget', 'ssh', 'scp', 'sudo']) {
      assert.ok(REFUSED_AGENT_COMMAND_WORDS.includes(word), word);
      assert.equal(refusedField(parse({ schema: 1, agentCommands: ['npm test', `${word} status`] })), 'conventions.agentCommands[1]', word);
    }
    assert.equal(refusedField(parse({ schema: 1, agentCommands: ['/usr/bin/git status'] })), 'conventions.agentCommands[0]');
    assert.equal(refusedField(parse({ schema: 1, agentCommands: ['GIT status'] })), 'conventions.agentCommands[0]');
  });

  it('allows the single trailing <paths> token and refuses any other <...> token, empty entries and chaining', () => {
    unwrap(parse({ schema: 1, agentCommands: ['npx tsc --noEmit <paths>', 'npm test'] }));
    for (const command of ['npm test <files>', '<paths> npm', 'npm <paths> test', 'npm test <paths> <paths>', 'npm test > out', 'npm test; curl x', 'npm test && git push', '', ' npm', 'npm  test', 'npm test | tee', 'npm $(id)']) {
      assert.equal(refusedField(parse({ schema: 1, agentCommands: [command] })), 'conventions.agentCommands[0]', JSON.stringify(command));
    }
    assert.equal(refusedField(parse({ schema: 1, agentCommands: 'npm test' })), 'conventions.agentCommands');
  });
});

describe('checkSpecDigest', () => {
  it('is stable for the same checks, independent of env key order, and changes when an argv word changes', () => {
    const a = unwrap(parse({ schema: 1, checks: [{ name: 'test', argv: ['npm', 'test'], env: { A: '1', B: '2' } }] }));
    const b = unwrap(parse('{"checks":[{"env":{"B":"2","A":"1"},"argv":["npm","test"],"name":"test"}],"schema":1}'));
    assert.equal(checkSpecDigest(a.checks), checkSpecDigest(b.checks));
    assert.match(checkSpecDigest(a.checks), /^sha256:[0-9a-f]{64}$/);
    const c = unwrap(parse({ schema: 1, checks: [{ name: 'test', argv: ['npm', 'run', 'test'], env: { A: '1', B: '2' } }] }));
    assert.notEqual(checkSpecDigest(a.checks), checkSpecDigest(c.checks));
  });
});
