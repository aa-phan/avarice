// Plan 04-28 (CON-10, CON-11, D-09): the retrieval cap table, the profile section that may only lower it, and the effective caps of a query.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RETRIEVAL_CAPS, RETRIEVAL_CAP_KEYS, effectiveCaps, parseRetrievalSection } from '../../src/domain/retrieval-rules.ts';

describe('RETRIEVAL_CAPS: the default of each step (docs/containment.md "Retrieval and resource safeguards")', () => {
  it('holds the documented values: 2,000 entries and 64 KiB, 200 hits and 10 s, 40-line snippets and 30 of them, 20 files and 256 KiB, 5 pages', () => {
    assert.deepEqual({ ...RETRIEVAL_CAPS }, {
      indexEntries: 2000,
      returnedBytes: 65536,
      searchHits: 200,
      queryTimeoutMs: 10_000,
      snippetLines: 40,
      snippets: 30,
      fullReads: 20,
      fullReadBytes: 262144,
      maxPages: 5,
    });
  });

  it('is frozen, so no caller raises a default', () => {
    assert.ok(Object.isFrozen(RETRIEVAL_CAPS));
  });
});

describe('parseRetrievalSection: the profile config may lower a cap and never raise it', () => {
  it('reads an absent section as the defaults', () => {
    const parsed = parseRetrievalSection(undefined);
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value, { ...RETRIEVAL_CAPS });
  });

  it('takes a lower value, a value equal to the default, and leaves the other caps at their defaults', () => {
    const parsed = parseRetrievalSection({ searchHits: 50, snippets: 30 });
    assert.ok(parsed.ok);
    assert.equal(parsed.value.searchHits, 50);
    assert.equal(parsed.value.snippets, 30);
    assert.equal(parsed.value.fullReadBytes, RETRIEVAL_CAPS.fullReadBytes);
  });

  it('refuses a value above the default, naming the key', () => {
    const parsed = parseRetrievalSection({ searchHits: 201 });
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.error.kind, 'invalid');
    if (parsed.error.kind === 'invalid') {
      assert.equal(parsed.error.field, 'retrieval.searchHits');
      assert.match(parsed.error.reason, /can only be lowered/);
    }
  });

  it('refuses an unknown key, a zero, a fraction, a string and a section that is not an object, each naming where', () => {
    const cases: Array<[unknown, string]> = [
      [{ pages: 3 }, 'retrieval.pages'],
      [{ snippets: 0 }, 'retrieval.snippets'],
      [{ snippets: 2.5 }, 'retrieval.snippets'],
      [{ snippets: '10' }, 'retrieval.snippets'],
      [['searchHits'], 'retrieval'],
      ['searchHits', 'retrieval'],
    ];
    for (const [raw, field] of cases) {
      const parsed = parseRetrievalSection(raw);
      assert.equal(parsed.ok, false, JSON.stringify(raw));
      if (!parsed.ok && parsed.error.kind === 'invalid') assert.equal(parsed.error.field, field, JSON.stringify(raw));
    }
  });

  it('lists every cap name in the refusal of an unknown one', () => {
    const parsed = parseRetrievalSection({ nope: 1 });
    assert.ok(!parsed.ok && parsed.error.kind === 'invalid');
    for (const key of RETRIEVAL_CAP_KEYS) assert.ok(parsed.error.kind === 'invalid' && parsed.error.reason.includes(key), key);
  });
});

describe('effectiveCaps: the smaller of the profile cap and the contract budget', () => {
  it('takes the minimum of each counted cap and passes the rest through', () => {
    const profile = { ...RETRIEVAL_CAPS, fullReads: 15, searchHits: 80 };
    const caps = effectiveCaps(profile, { searches: 10, fullReads: 20, fullReadBytes: 1000, broadDiscovery: false });
    assert.equal(caps.fullReads, 15, 'the profile is lower');
    assert.equal(caps.fullReadBytes, 1000, 'the contract is lower');
    assert.equal(caps.searchHits, 80);
    assert.equal(caps.searches, 10);
    assert.equal(caps.broadDiscovery, false);
  });

  it('with no contract the profile caps stand, searches are uncounted and broad discovery is not authorized', () => {
    const caps = effectiveCaps({ ...RETRIEVAL_CAPS });
    assert.equal(caps.fullReads, RETRIEVAL_CAPS.fullReads);
    assert.equal(caps.searches, null);
    assert.equal(caps.broadDiscovery, false);
  });

  it('authorizes broad discovery only when the contract says true', () => {
    assert.equal(effectiveCaps({ ...RETRIEVAL_CAPS }, { broadDiscovery: true }).broadDiscovery, true);
    assert.equal(effectiveCaps({ ...RETRIEVAL_CAPS }, {}).broadDiscovery, false);
  });
});
