// Plan 04-30 (OPS-5, D-13): the limits section of the profile config and the pack budget that follows from it. Pure: nothing here reads a file or a ledger.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runPromptRoom } from '../../src/app/run-gsd-config.ts';
import type { RunPromptContract } from '../../src/app/run-gsd-config.ts';
import { LIMIT_DEFAULTS, effectivePackBudget, parseLimitsSection } from '../../src/domain/resource-bounds.ts';

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
};
const refusal = (raw: unknown): { field: string; reason: string } => {
  const result = parseLimitsSection(raw);
  assert.ok(!result.ok, `expected a refusal for ${JSON.stringify(raw)}`);
  assert.equal(result.error.kind, 'invalid');
  return result.error as unknown as { field: string; reason: string };
};

describe('tracer: parseLimitsSection gives the documented defaults for a missing or empty section (OPS-5)', () => {
  it('holds the documented defaults', () => {
    assert.deepEqual(LIMIT_DEFAULTS, { contextTokens: 24000, maxConcurrentChecks: 1, artifactQuotaMiB: 2048, maxActiveRuns: 20, maxEventRows: 500000, checkOutputBytes: 5 * 1024 * 1024 });
  });

  it('gives the defaults for no section and for an empty one (the empty edge)', () => {
    assert.deepEqual(must(parseLimitsSection(undefined)), LIMIT_DEFAULTS);
    assert.deepEqual(must(parseLimitsSection({})), LIMIT_DEFAULTS);
  });

  it('keeps the keys it is given and the defaults of the rest', () => {
    const parsed = must(parseLimitsSection({ contextTokens: 100, maxActiveRuns: 2, artifactQuotaMiB: 1, maxConcurrentChecks: 2, maxEventRows: 50, checkOutputBytes: 1000 }));
    assert.deepEqual(parsed, { contextTokens: 100, maxConcurrentChecks: 2, artifactQuotaMiB: 1, maxActiveRuns: 2, maxEventRows: 50, checkOutputBytes: 1000 });
    assert.equal(must(parseLimitsSection({ maxActiveRuns: 5 })).contextTokens, 24000);
  });

  it('returns a copy: changing the result never changes the defaults', () => {
    const parsed = must(parseLimitsSection(undefined)) as { contextTokens: number };
    parsed.contextTokens = 1;
    assert.equal(LIMIT_DEFAULTS.contextTokens, 24000);
  });
});

describe('parseLimitsSection refuses what cannot be a limit, naming limits.<key>', () => {
  it('refuses a negative value, zero, a fraction, a string and a non-finite number', () => {
    for (const value of [-1, 0, 1.5, '24000', Number.NaN, Number.POSITIVE_INFINITY, null, true]) {
      assert.equal(refusal({ maxActiveRuns: value }).field, 'limits.maxActiveRuns', `value ${String(value)}`);
    }
  });

  it('refuses a number past the safe integers', () => {
    assert.equal(refusal({ artifactQuotaMiB: 2 ** 60 }).field, 'limits.artifactQuotaMiB');
  });

  it('refuses maxConcurrentChecks 3 (at most 2) and accepts 1 and 2', () => {
    const refused = refusal({ maxConcurrentChecks: 3 });
    assert.equal(refused.field, 'limits.maxConcurrentChecks');
    assert.match(refused.reason, /at most 2/);
    assert.equal(must(parseLimitsSection({ maxConcurrentChecks: 1 })).maxConcurrentChecks, 1);
    assert.equal(must(parseLimitsSection({ maxConcurrentChecks: 2 })).maxConcurrentChecks, 2);
  });

  it('refuses an unknown key and a section that is not an object', () => {
    assert.equal(refusal({ maxRuns: 3 }).field, 'limits.maxRuns');
    for (const raw of [[], 'x', 3, null]) assert.equal(refusal(raw).field, 'limits');
  });

  it('prints a key from a hand-edited file safely: no control characters, at most 40 of them', () => {
    const field = refusal({ ['bad\u001b[31mkey' + 'x'.repeat(80)]: 1 }).field;
    assert.ok(!/[\u0000-\u001f]/.test(field));
    assert.ok(field.length <= 'limits.'.length + 40);
  });
});

describe('effectivePackBudget: the ceiling or the room left in the prompt, whichever is smaller (D-13)', () => {
  it('is min(ceiling, floor((promptMax - contractBytes - overhead) / 4)): 6192 for the documented case', () => {
    assert.equal(effectivePackBudget(24000, 32768, 6000, 2000), 6192);
  });

  it('floors the quarter (the precision edge): the budget drops by one token only when the room falls below the next multiple of four bytes', () => {
    assert.equal(effectivePackBudget(24000, 32768, 6001, 2000), 6191);
    assert.equal(effectivePackBudget(24000, 32768, 6004, 2000), 6191);
    assert.equal(effectivePackBudget(24000, 32768, 6005, 2000), 6190);
  });

  it('is clamped at 0 when the contract and the overhead fill the prompt, or pass it', () => {
    assert.equal(effectivePackBudget(24000, 32768, 40000, 2000), 0);
    assert.equal(effectivePackBudget(24000, 32768, 30768, 2000), 0);
    assert.equal(effectivePackBudget(24000, 32768, 30767, 2000), 0, 'less than one token of room is no room');
  });

  it('is the ceiling when the ceiling is the smaller number', () => {
    assert.equal(effectivePackBudget(5000, 32768, 6000, 2000), 5000);
    assert.equal(effectivePackBudget(6192, 32768, 6000, 2000), 6192);
  });

  it('never exceeds a quarter of the prompt cap, whatever the ceiling', () => {
    assert.equal(effectivePackBudget(1_000_000, 32768, 0, 0), 8192);
  });
});

describe('runPromptRoom counts UTF-8 bytes, not characters (the encoding edge)', () => {
  const contract = (title: string): RunPromptContract => ({
    execution: { commands: [] },
    intent: { title, behavior: 'b', acceptance: [], exclusions: [] },
    files: { write: [], create: [], artifacts: [] },
    decisions: { human: [], delegated: [] },
  });

  it('is larger for a title in another script than for an ASCII one of the same length', () => {
    const ascii = runPromptRoom(contract('a'.repeat(100)));
    const accented = runPromptRoom(contract('é'.repeat(100)));
    assert.equal(accented.contractBytes - ascii.contractBytes, 100, 'each é is two bytes, one more than an a');
    assert.equal(accented.overhead, ascii.overhead);
  });

  it('counts the fence lines the pack sits in as fixed overhead', () => {
    const { overhead } = runPromptRoom(contract('t'));
    assert.ok(overhead > 100 && overhead < 400, `the fence is a few lines of fixed text, got ${overhead}`);
  });
});
