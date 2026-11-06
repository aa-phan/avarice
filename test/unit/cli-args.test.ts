// parseArgs and the CLI entry with flag names that collide with Object.prototype (review WR-05).
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';
import { parseArgs } from '../../src/cli/args.ts';
import { makeRoots, runCli, type CliRoots } from '../helpers/run-cli.ts';

const NAMES = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', '__defineGetter__'] as const;

describe('parseArgs (WR-05)', () => {
  for (const name of NAMES) {
    it(`--${name}=x is an own property and does not throw`, () => {
      const r = parseArgs([`--${name}=x`]);
      assert.equal(Object.hasOwn(r.flags, name), true);
      assert.equal(r.flags[name], 'x');
      assert.deepEqual(r.repeated?.[name], ['x']);
    });

    it(`--${name} v takes the next word as its value`, () => {
      const r = parseArgs([`--${name}`, 'v']);
      assert.equal(r.flags[name], 'v');
      assert.deepEqual(r.repeated?.[name], ['v']);
      assert.deepEqual(r.positionals, []);
    });

    it(`bare --${name} is boolean true`, () => {
      const r = parseArgs([`--${name}`]);
      assert.equal(r.flags[name], true);
      assert.equal(Object.hasOwn(r.repeated ?? {}, name), false);
    });
  }

  it('flags and repeated have no prototype', () => {
    const r = parseArgs(['--a=1']);
    assert.equal(Object.getPrototypeOf(r.flags), null);
    assert.equal(Object.getPrototypeOf(r.repeated), null);
  });

  it('keeps every value of a repeated flag and the last one in flags', () => {
    const r = parseArgs(['--budget', 'a=1', '--budget', 'b=2', 'repo']);
    assert.deepEqual(r.repeated?.['budget'], ['a=1', 'b=2']);
    assert.equal(r.flags['budget'], 'b=2');
    assert.deepEqual(r.positionals, ['repo']);
  });

  it('a declared boolean flag leaves the next word positional', () => {
    const r = parseArgs(['--json', 'path'], { boolean: ['json'] });
    assert.equal(r.flags['json'], true);
    assert.deepEqual(r.positionals, ['path']);
  });

  it('-- makes everything after it positional', () => {
    const r = parseArgs(['a', '--', '--x', 'b']);
    assert.deepEqual(r.positionals, ['a', '--x', 'b']);
  });
});

describe('avarice onboard with an Object.prototype flag name (WR-05)', () => {
  let roots: CliRoots | undefined;
  afterEach(() => {
    if (roots) rmSync(roots.base, { recursive: true, force: true });
    roots = undefined;
  });

  for (const argv of [['onboard', '--__proto__=x'], ['onboard', '--constructor', 'x', '--toString']]) {
    it(`${argv.join(' ')} exits 64 with a usage error and no stack trace`, () => {
      roots = makeRoots();
      const r = runCli(argv, { roots, env: { AVARICE_LIVE: undefined } });
      assert.equal(r.code, 64, r.stderr);
      assert.match(r.stderr, /avarice onboard:/);
      assert.doesNotMatch(r.stderr, /TypeError|\n\s+at /);
    });
  }
});

describe('avarice with no arguments (FR-27, ADR-013 decision 1)', () => {
  let roots: CliRoots | undefined;
  afterEach(() => {
    if (roots) rmSync(roots.base, { recursive: true, force: true });
    roots = undefined;
  });

  // The child's standard streams are pipes, so neither is a terminal: the shell does not open.
  it('prints usage on standard error and exits 64 when no stream is a terminal', () => {
    roots = makeRoots();
    const r = runCli([], { roots });
    assert.equal(r.code, 64, r.stderr);
    assert.match(r.stderr, /avarice: no command given/);
    assert.match(r.stderr, /usage: avarice <command> \[options\]/);
    assert.equal(r.stdout, '');
  });

  it('prints usage and exits 64 under AVARICE_RUN too, and leaves `avarice <command>` and `--help` one-shot', () => {
    roots = makeRoots();
    const bare = runCli([], { roots, env: { AVARICE_RUN: 'run_01HX' } });
    assert.equal(bare.code, 64, bare.stderr);
    assert.match(bare.stderr, /no command given/);
    const status = runCli(['status'], { roots });
    assert.equal(status.code, 0, status.stderr);
    assert.match(status.stdout, /^status: 0 project\(s\)/);
    const help = runCli(['--help'], { roots });
    assert.equal(help.code, 0);
    assert.match(help.stdout, /usage: avarice <command>/);
  });
});
