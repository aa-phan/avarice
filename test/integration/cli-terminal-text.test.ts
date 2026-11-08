// R-WR-01 and T-02-03: no line a command prints may carry a terminal escape from a user-supplied ID or a
// repository path. This file spawns the real CLI on isolated temporary roots and checks the bytes it prints.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';

const ESC = '\x1b';
const EXIT_USAGE = 64;

const cleanup: string[] = [];
let roots: CliRoots;

before(() => {
  roots = makeRoots();
  cleanup.push(roots.base);
  const init = runCli(['init'], { roots });
  assert.equal(init.code, 0, init.stderr);
});

after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

describe('terminal text through the real CLI (R-WR-01)', () => {
  it('resume echoes an unknown onboarding ID with the escape sequence removed', () => {
    const result = runCli(['resume', `onb_X${ESC}[31mY`], { roots });
    assert.equal(result.code, EXIT_USAGE);
    assert.ok(!result.stderr.includes(ESC), JSON.stringify(result.stderr));
    assert.ok(!result.stdout.includes(ESC), JSON.stringify(result.stdout));
    assert.ok(result.stderr.includes('Y'), result.stderr);
  });

  it('onboard echoes a repository path with the escape sequence removed', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'avarice-term-'));
    cleanup.push(scratch);
    const path = `${scratch}/x${ESC}[2Jy`;
    mkdirSync(path);
    const result = runCli(['onboard', '--policy', 'onboarding', path], { roots });
    // Exit code at the plan base: the directory is no git repository, so onboarding is refused as invalid input.
    assert.equal(result.code, EXIT_USAGE, result.stderr);
    assert.ok(!result.stderr.includes(ESC), JSON.stringify(result.stderr));
    assert.ok(!result.stdout.includes(ESC), JSON.stringify(result.stdout));
    assert.ok(result.stderr.includes('y'), result.stderr);
  });
});
