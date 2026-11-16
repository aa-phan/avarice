// The domain Redactor (SEC-3, D-14): secret patterns plus seeded literals, precise enough to leave digests, IDs and paths alone.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { seedProcessRedactor } from '../../src/adapters/redaction/process-redactor.ts';
import { appendHistory, HISTORY_FILE, loadHistory } from '../../src/cli/shell/history.ts';
import { MIN_SEEDED_SECRET_LENGTH, Redactor, redactLeaves } from '../../src/domain/redactor.ts';

// Built from parts so this file holds no complete secret-shaped literal.
const GITHUB_TOKEN = `ghp_${'a1B2c3D4e5'.repeat(4).slice(0, 36)}`;
const DIGEST = `sha256:${'0123456789abcdef'.repeat(4)}`;
const RUN_ID = 'run_01M71BDV8MWGEG7XSAWH1GZ80W';
const REPO_PATH = '/Users/x/repo/src/a.ts';

describe('Redactor.seed', () => {
  it('refuses a value shorter than the minimum, naming MIN_SEEDED_SECRET_LENGTH', () => {
    const redactor = new Redactor();
    const seeded = redactor.seed('short');
    assert.equal(seeded.ok, false);
    if (!seeded.ok) {
      assert.equal(seeded.error.kind, 'invalid');
      assert.match(JSON.stringify(seeded.error), /MIN_SEEDED_SECRET_LENGTH/);
    }
    assert.equal(redactor.redact('a short word'), 'a short word', 'a refused literal is not redacted');
  });

  it('accepts a value of exactly the minimum length and redacts it', () => {
    const redactor = new Redactor();
    const value = 'x'.repeat(MIN_SEEDED_SECRET_LENGTH);
    assert.equal(MIN_SEEDED_SECRET_LENGTH, 8);
    assert.equal(redactor.seed(value).ok, true);
    assert.equal(redactor.seed(value.slice(1)).ok, false, 'one character fewer is refused');
    assert.equal(redactor.redact(`token=${value};`), 'token=[REDACTED:seeded];');
  });

  it('redacts every occurrence of a seeded literal, and seeding twice changes nothing', () => {
    const redactor = new Redactor();
    redactor.seed('s3cr3t-value-123');
    redactor.seed('s3cr3t-value-123');
    assert.equal(redactor.redact('a s3cr3t-value-123 b s3cr3t-value-123'), 'a [REDACTED:seeded] b [REDACTED:seeded]');
  });

  it('redacts two overlapping seeded literals, leaving no fragment of either', () => {
    const redactor = new Redactor();
    redactor.seed('alpha-beta-1');
    redactor.seed('beta-1-gamma');
    assert.equal(redactor.redact('x alpha-beta-1-gamma y'), 'x [REDACTED:seeded] y');
  });

  it('redacts a seeded literal that contains another seeded literal as one marker', () => {
    const redactor = new Redactor();
    redactor.seed('password');
    redactor.seed('password-and-more');
    assert.equal(redactor.redact('is password-and-more here'), 'is [REDACTED:seeded] here');
  });
});

describe('Redactor.redact', () => {
  it('applies the secret patterns', () => {
    const redactor = new Redactor();
    assert.equal(redactor.redact(`token ${GITHUB_TOKEN}`), 'token [REDACTED:github-token]');
    assert.equal(redactor.redact('Authorization: Bearer abcdefghij0123456789'), '[REDACTED:authorization]');
  });

  it('leaves a digest, a run ID and a repository path unchanged', () => {
    const redactor = new Redactor();
    redactor.seed('s3cr3t-value-123');
    for (const text of [DIGEST, RUN_ID, REPO_PATH, `${RUN_ID} read ${REPO_PATH} (${DIGEST})`]) assert.equal(redactor.redact(text), text);
  });
});

describe('redactLeaves', () => {
  const redactor = new Redactor();

  it('redacts string leaves at every depth and keeps numbers, booleans, null and key names', () => {
    const input = { count: 3, ok: true, none: null, list: [GITHUB_TOKEN, 7, { deep: `x ${GITHUB_TOKEN}` }], [GITHUB_TOKEN]: 'key name kept' };
    assert.deepEqual(redactLeaves(input, redactor), {
      count: 3,
      ok: true,
      none: null,
      list: ['[REDACTED:github-token]', 7, { deep: 'x [REDACTED:github-token]' }],
      [GITHUB_TOKEN]: 'key name kept',
    });
  });

  it('returns a new object and does not mutate its input', () => {
    const input = { a: { b: [GITHUB_TOKEN] } };
    const snapshot = JSON.stringify(input);
    const out = redactLeaves(input, redactor) as typeof input;
    assert.notEqual(out, input);
    assert.notEqual(out.a, input.a);
    assert.notEqual(out.a.b, input.a.b);
    assert.equal(JSON.stringify(input), snapshot);
  });

  it('passes a bare string, a number and undefined through', () => {
    assert.equal(redactLeaves(GITHUB_TOKEN, redactor), '[REDACTED:github-token]');
    assert.equal(redactLeaves(5, redactor), 5);
    assert.equal(redactLeaves(undefined, redactor), undefined);
  });

  it('returns a non-plain object as it is, so the canonical form still refuses it', () => {
    const when = new Date(0);
    assert.equal(redactLeaves(when, redactor), when);
  });
});

describe('the interactive shell history (SEC-3)', () => {
  function inDataRoot(fn: (dataRoot: string) => void): void {
    const dataRoot = mkdtempSync(join(tmpdir(), 'avarice-history-'));
    try {
      fn(dataRoot);
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
    }
  }

  it('writes a line holding an Authorization Bearer header with a 20-character token redacted', () => {
    inDataRoot((dataRoot) => {
      const token = 'abcdefghij0123456789';
      assert.equal(token.length, 20);
      assert.equal(appendHistory(dataRoot, `inbox --header "Authorization: Bearer ${token}"`), true);
      const onDisk = readFileSync(join(dataRoot, HISTORY_FILE), 'utf8');
      assert.ok(!onDisk.includes(token), onDisk);
      assert.ok(onDisk.includes('[REDACTED:authorization]'), onDisk);
      assert.deepEqual(loadHistory(dataRoot), ['inbox --header "[REDACTED:authorization]"']);
    });
  });

  it('writes a line holding a seeded credential value redacted', () => {
    inDataRoot((dataRoot) => {
      assert.equal(seedProcessRedactor('typed-credential-77').ok, true);
      appendHistory(dataRoot, 'login typed-credential-77 now');
      assert.deepEqual(loadHistory(dataRoot), ['login [REDACTED:seeded] now']);
    });
  });

  it('keeps an ordinary command, a run ID and a digest as typed', () => {
    inDataRoot((dataRoot) => {
      const line = `status ${RUN_ID} ${DIGEST}`;
      appendHistory(dataRoot, line);
      assert.deepEqual(loadHistory(dataRoot), [line]);
    });
  });
});
