// Plan 01-19 gap fix (deferred item 12, store mode): the ledger holds the full text of every transcript reference and the budget
// state, so its files must not be readable by other users. A new store is created 0600 (01-02). openDb also tightens an existing
// store file and its -wal and -shm siblings to 0600 when the current user owns them, and refuses to open one another user owns.
// Every store here lives under a temp directory; nothing opens the user's real store.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeError, openDb } from '../../src/adapters/sqlite/db.ts';
import { makeRoots, runCli } from '../helpers/run-cli.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function tempStore(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-store-mode-')));
  cleanup.push(dir);
  return join(dir, 'state.db');
}

const modeOf = (path: string): number => statSync(path).mode & 0o777;
const SIBLINGS = ['-wal', '-shm'];

// A store with live -wal and -shm files: the first connection stays open, so SQLite has not deleted them.
function liveStore(): { path: string; holder: ReturnType<typeof openDb> & { ok: true } } {
  const path = tempStore();
  const holder = openDb(path);
  assert.ok(holder.ok, holder.ok ? '' : describeError(holder.error));
  holder.value.exec('CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1);');
  for (const suffix of SIBLINGS) assert.ok(existsSync(`${path}${suffix}`), `${suffix} exists while a connection is open`);
  return { path, holder };
}

describe('openDb tightens a store the current user owns', () => {
  it('sets a 0644 store and its -wal and -shm siblings to 0600', () => {
    const { path, holder } = liveStore();
    for (const file of [path, `${path}-wal`, `${path}-shm`]) chmodSync(file, 0o644);
    const again = openDb(path);
    assert.ok(again.ok, again.ok ? '' : describeError(again.error));
    try {
      for (const file of [path, `${path}-wal`, `${path}-shm`]) assert.equal(modeOf(file), 0o600, file);
    } finally {
      again.value.close();
      holder.value.close();
    }
  });

  it('tightens group-readable and group-writable modes too, but never loosens a stricter one', () => {
    const path = tempStore();
    const created = openDb(path);
    assert.ok(created.ok);
    created.value.close();
    chmodSync(path, 0o640);
    for (const [before, after] of [[0o640, 0o600], [0o666, 0o600], [0o755, 0o600], [0o400, 0o400], [0o600, 0o600]] as const) {
      chmodSync(path, before);
      const opened = openDb(path);
      assert.ok(opened.ok, opened.ok ? '' : describeError(opened.error));
      opened.value.close();
      assert.equal(modeOf(path), after, `from ${before.toString(8)}`);
      chmodSync(path, 0o600);
    }
  });

  it('keeps a read-only open read-only: it does not change the mode, so a status read never edits the store', () => {
    const path = tempStore();
    const created = openDb(path);
    assert.ok(created.ok);
    created.value.close();
    chmodSync(path, 0o644);
    const opened = openDb(path, { readOnly: true });
    assert.ok(opened.ok, opened.ok ? '' : describeError(opened.error));
    opened.value.close();
    assert.equal(modeOf(path), 0o644);
  });

  it('a new store is still created 0600', () => {
    const path = tempStore();
    const created = openDb(path);
    assert.ok(created.ok);
    created.value.close();
    assert.equal(modeOf(path), 0o600);
  });
});

describe('openDb refuses a store another user owns', () => {
  it('returns an error that names the file and both users, changes no mode and opens nothing', () => {
    const path = tempStore();
    const created = openDb(path);
    assert.ok(created.ok);
    created.value.close();
    chmodSync(path, 0o644);
    const owner = statSync(path).uid;
    for (const readOnly of [false, true]) {
      const refused = openDb(path, { readOnly, currentUid: owner + 1 });
      assert.equal(refused.ok, false, `readOnly ${readOnly}`);
      if (refused.ok) return;
      const message = describeError(refused.error);
      assert.ok(message.includes(path), message);
      assert.match(message, new RegExp(`owned by user ${owner}, not by the current user ${owner + 1}`));
      assert.match(message, /refusing to open/);
    }
    assert.equal(modeOf(path), 0o644, 'a store the user does not own is not chmodded');
    for (const suffix of SIBLINGS) assert.equal(existsSync(`${path}${suffix}`), false, `${suffix} was not created`);
  });
});

describe('the CLI tightens the store of a profile it opens', () => {
  it('an existing 0644 state.db under temp roots is 0600 after the next command that writes', () => {
    const roots = makeRoots();
    cleanup.push(roots.base);
    const first = runCli(['init'], { roots });
    assert.equal(first.code, 0, first.stdout + first.stderr);
    const store = join(roots.AVARICE_DATA_ROOT, 'state.db');
    chmodSync(store, 0o644);
    const second = runCli(['init'], { roots });
    assert.equal(second.code, 0, second.stdout + second.stderr);
    assert.equal(modeOf(store), 0o600);
    for (const suffix of SIBLINGS) if (existsSync(`${store}${suffix}`)) assert.equal(modeOf(`${store}${suffix}`), 0o600, suffix);
  });
});
