// The responder identity rule and the process-ancestry reader (plan 03-15; D-14, D-18, CS-11). `contract amend` uses them first; `decide`,
// `cancel` and `schedule` reuse them. The ancestry reader is also run for real against this test process.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { cutCommand, inRunProcessTree, processAncestry } from '../../src/adapters/proc/ancestry.ts';
import type { ProcessEntry } from '../../src/adapters/proc/ancestry.ts';
import { err, ok } from '../../src/domain/result.ts';
import type { Result } from '../../src/domain/result.ts';
import { ownsProfile, refuseOutsideTerminal, responderName } from '../../src/cli/identity.ts';
import type { IdentityContext } from '../../src/cli/identity.ts';

const SUPERVISOR = '/usr/local/bin/node --disable-warning=ExperimentalWarning /opt/avarice/bin/avarice.ts supervise run_01ABC';

const entry = (pid: number, ppid: number, command: string): ProcessEntry => ({ pid, ppid, command });
const calm = (): Result<ProcessEntry[]> => ok([entry(300, 200, 'node avarice.ts contract amend run_01ABC'), entry(200, 100, '-zsh'), entry(100, 1, 'login'), entry(1, 0, '/sbin/launchd')]);
const inside = (): Result<ProcessEntry[]> => ok([entry(300, 250, 'bash'), entry(250, 200, 'claude --print'), entry(200, 1, SUPERVISOR), entry(1, 0, '/sbin/launchd')]);

interface Spy {
  context: IdentityContext;
  reads(): number;
}

function context(options: { stdin?: boolean; stdout?: boolean; ancestry?: () => Result<ProcessEntry[]> } = {}): Spy {
  let reads = 0;
  return {
    context: {
      terminal: { stdinIsTty: options.stdin ?? true, stdoutIsTty: options.stdout ?? true },
      ancestry: () => {
        reads += 1;
        return (options.ancestry ?? calm)();
      },
    },
    reads: () => reads,
  };
}

describe('refuseOutsideTerminal (CS-11, D-18)', () => {
  it('returns undefined on a terminal, outside a run, with a calm ancestry', () => {
    const spy = context();
    assert.equal(refuseOutsideTerminal({}, spy.context), undefined);
    assert.equal(spy.reads(), 1);
  });

  it('refuses inside a run when AVARICE_RUN is set, with no further check', () => {
    const spy = context({ stdin: false });
    assert.equal(refuseOutsideTerminal({ AVARICE_RUN: 'run_01ABC' }, spy.context), 'refused inside a run (AVARICE_RUN is set)');
    assert.equal(spy.reads(), 0, 'the process table is not read');
  });

  it('refuses a standard input or a standard output that is not a terminal', () => {
    for (const options of [{ stdin: false }, { stdout: false }, { stdin: false, stdout: false }]) {
      const spy = context(options);
      assert.equal(refuseOutsideTerminal({}, spy.context), 'needs an interactive terminal', JSON.stringify(options));
      assert.equal(spy.reads(), 0);
    }
  });

  it("refuses from inside a run's process tree, with the supervisor among the ancestors", () => {
    assert.equal(refuseOutsideTerminal({}, context({ ancestry: inside }).context), "refused from inside a run's process tree");
  });

  it('refuses when the ancestry cannot be read: it fails closed', () => {
    const unreadable = (): Result<ProcessEntry[]> => err({ kind: 'unavailable', cause: 'ps is not allowed here' });
    assert.equal(refuseOutsideTerminal({}, context({ ancestry: unreadable }).context), "refused from inside a run's process tree");
  });

  it('applies the checks in order: AVARICE_RUN, then the terminal, then the ancestry', () => {
    assert.equal(refuseOutsideTerminal({ AVARICE_RUN: 'x' }, context({ stdout: false, ancestry: inside }).context), 'refused inside a run (AVARICE_RUN is set)');
    assert.equal(refuseOutsideTerminal({}, context({ stdout: false, ancestry: inside }).context), 'needs an interactive terminal');
  });
});

describe('inRunProcessTree (CS-11)', () => {
  it('is false for a chain of shells and node processes without the supervisor signature', () => {
    const chain = ok([
      entry(40, 30, '/usr/local/bin/node --test test/unit/identity.test.ts'),
      entry(30, 20, 'npm test'),
      entry(20, 10, '-zsh'),
      entry(10, 1, '/usr/bin/login -pf aphan'),
      entry(1, 0, '/sbin/launchd'),
    ]);
    assert.equal(inRunProcessTree(chain), false);
  });

  it('is true when any ancestor carries `supervise run_<id>`', () => {
    assert.equal(inRunProcessTree(inside()), true);
    assert.equal(inRunProcessTree(ok([entry(5, 1, 'supervise run_01ABC')])), false, 'the signature needs a space before supervise');
    assert.equal(inRunProcessTree(ok([entry(5, 1, 'node a supervise run_01ABC')])), true);
  });

  it('is false for a command that says supervise without a run ID, or names a run in another command', () => {
    assert.equal(inRunProcessTree(ok([entry(5, 1, 'node avarice.ts supervise')])), false);
    assert.equal(inRunProcessTree(ok([entry(5, 1, 'node avarice.ts status run_01ABC')])), false);
  });

  it('is true when the ancestry could not be read (fail closed)', () => {
    assert.equal(inRunProcessTree(err({ kind: 'unavailable', cause: 'no ps' })), true);
  });
});

describe('cutCommand', () => {
  it('leaves a command of at most 400 characters alone', () => {
    const text = `node ${'a'.repeat(395)}`;
    assert.equal(text.length, 400);
    assert.equal(cutCommand(text), text);
  });

  it('cuts a longer command to 400 characters and keeps its end, where the supervisor signature sits', () => {
    const long = `/usr/local/bin/node ${'--flag '.repeat(200)}/opt/avarice/bin/avarice.ts supervise run_01ABC`;
    const cut = cutCommand(long);
    assert.ok(cut.length <= 400, String(cut.length));
    assert.ok(cut.startsWith('/usr/local/bin/node'));
    assert.ok(cut.endsWith(' supervise run_01ABC'));
    assert.equal(inRunProcessTree(ok([entry(5, 1, cut)])), true);
  });
});

describe('processAncestry (CS-11)', () => {
  it('walks from this process to pid 1 within 64 hops, each entry with pid, ppid and a command of at most 400 characters', () => {
    const chain = processAncestry(process.pid);
    assert.ok(chain.ok, chain.ok ? '' : JSON.stringify(chain.error));
    const entries = chain.value;
    assert.ok(entries.length >= 2 && entries.length <= 64, String(entries.length));
    assert.equal(entries[0]?.pid, process.pid);
    assert.equal(entries[0]?.ppid, process.ppid);
    assert.equal(entries.at(-1)?.pid, 1);
    for (const [i, e] of entries.entries()) {
      assert.ok(Number.isInteger(e.pid) && Number.isInteger(e.ppid), JSON.stringify(e));
      assert.ok(e.command.length > 0 && e.command.length <= 400, `${e.pid}: ${e.command.length}`);
      if (i > 0) assert.equal(e.pid, entries[i - 1]?.ppid, 'each entry is the parent of the one before');
    }
    assert.equal(inRunProcessTree(chain), false, 'this test is not inside a run');
  });

  it('is unavailable for a process that does not exist', () => {
    const chain = processAncestry(2_147_483_000);
    assert.equal(chain.ok, false);
    assert.equal(inRunProcessTree(chain), true);
  });
});

describe('responderName and ownsProfile (D-14)', () => {
  it('names the OS user the process runs as', () => {
    assert.equal(responderName(), userInfo().username);
  });

  it('owns a directory this process created, and nothing that does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'avarice-identity-'));
    try {
      assert.equal(ownsProfile(dir), true);
      assert.equal(ownsProfile(join(dir, 'missing')), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
