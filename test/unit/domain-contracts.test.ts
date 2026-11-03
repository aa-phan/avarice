import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Result } from '../../src/domain/result.ts';
import type { OnboardingState } from '../../src/domain/onboarding-lifecycle.ts';
import { ok, err } from '../../src/domain/result.ts';
import { ulid, newId } from '../../src/domain/ids.ts';
import { canonicalJson, sha256Hex, digestOf } from '../../src/domain/digest.ts';
import {
  TRANSITIONS,
  NEXT_ACTIONS,
  assertTransition,
  isStopState,
} from '../../src/domain/onboarding-lifecycle.ts';
import {
  ONBOARDING_PRESET,
  compileOnboardingContract,
  contractDigest,
} from '../../src/domain/onboarding-contract.ts';
import {
  FULL_MAP_FILES,
  FAST_MAP_FILES,
  completenessFor,
} from '../../src/domain/mapping.ts';
import { validateMapArtifacts } from '../../src/domain/validation.ts';
import type { MapArtifactFacts } from '../../src/domain/validation.ts';
import { buildProjectRecord, recordDigest } from '../../src/domain/project-record.ts';

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------
describe('result', () => {
  it('ok and err build the two Result shapes', () => {
    assert.deepEqual(ok(3), { ok: true, value: 3 });
    assert.deepEqual(err({ kind: 'not_found', ref: 'x' }), {
      ok: false,
      error: { kind: 'not_found', ref: 'x' },
    });
  });
});

// ---------------------------------------------------------------------------
// Lifecycle. The oracle below is written from docs/repository-onboarding.md
// (state diagram) and SKELETON.md "Onboarding lifecycle", independent of the module.
// ---------------------------------------------------------------------------
const DIAGRAM_EDGES: ReadonlyArray<readonly [string, string]> = [
  ['unregistered', 'discovered'],
  ['discovered', 'contract_proposed'],
  ['contract_proposed', 'mapping'],
  ['contract_proposed', 'blocked'],
  ['mapping', 'validating'],
  ['mapping', 'paused'],
  ['paused', 'mapping'],
  ['validating', 'validation_failed'],
  ['validation_failed', 'mapping'],
  ['validation_failed', 'blocked'],
  ['validating', 'planning'],
  ['validating', 'planning_ready'],
  ['planning', 'planning_ready'],
  ['planning', 'blocked'],
  ['planning_ready', 'active'],
  ['active', 'stale'],
  ['stale', 'mapping'],
  ['active', 'incompatible'],
  ['incompatible', 'contract_proposed'],
  ['blocked', 'contract_proposed'],
  ['active', 'deactivated'],
  ['deactivated', 'discovered'],
];
const NON_TERMINAL_PRE_ACTIVATION = [
  'discovered',
  'contract_proposed',
  'mapping',
  'paused',
  'validating',
  'validation_failed',
  'planning',
  'planning_ready',
];
const ALL_STATES: readonly OnboardingState[] = [
  'unregistered',
  'discovered',
  'contract_proposed',
  'mapping',
  'paused',
  'validating',
  'validation_failed',
  'planning',
  'planning_ready',
  'active',
  'stale',
  'incompatible',
  'blocked',
  'deactivated',
];
const EXPECTED_EDGES = new Set<string>([
  ...DIAGRAM_EDGES.map(([a, b]) => `${a}>${b}`),
  ...NON_TERMINAL_PRE_ACTIVATION.map((s) => `${s}>blocked`),
  'discovered>incompatible',
  'contract_proposed>incompatible',
]);

describe('onboarding lifecycle', () => {
  it('assertTransition accepts every edge in TRANSITIONS', () => {
    assert.ok(TRANSITIONS.length > 0, 'TRANSITIONS must not be empty');
    for (const [from, to] of TRANSITIONS) {
      assert.equal(assertTransition(from, to).ok, true, `${from} -> ${to}`);
    }
  });

  it('accepts every documented edge and nothing else, over all 14x14 pairs', () => {
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        const expected = EXPECTED_EDGES.has(`${from}>${to}`);
        assert.equal(assertTransition(from, to).ok, expected, `${from} -> ${to}`);
      }
    }
  });

  it('rejects active -> mapping, unregistered -> active and blocked -> active with kind invalid', () => {
    for (const [from, to] of [
      ['active', 'mapping'],
      ['unregistered', 'active'],
      ['blocked', 'active'],
    ] as const) {
      const r = assertTransition(from, to);
      assert.equal(r.ok, false, `${from} -> ${to}`);
      if (!r.ok) assert.equal(r.error.kind, 'invalid');
    }
  });

  it('rejects a state name that is not in the lifecycle', () => {
    const r = assertTransition('nonsense' as OnboardingState, 'active');
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.kind, 'invalid');
  });

  it('isStopState is true only for active, blocked, incompatible and deactivated', () => {
    const stops = ALL_STATES.filter((s) => isStopState(s));
    assert.deepEqual(stops.sort(), ['active', 'blocked', 'deactivated', 'incompatible']);
  });

  it('NEXT_ACTIONS lists the checkpoint actions of SKELETON.md in order', () => {
    assert.deepEqual(NEXT_ACTIONS.discovered, ['compile-contract']);
    assert.deepEqual(NEXT_ACTIONS.contract_proposed, [
      'prepare-workspace',
      'configure-gsd',
      'verify-enforcement',
    ]);
    assert.deepEqual(NEXT_ACTIONS.mapping, ['launch:map']);
    assert.deepEqual(NEXT_ACTIONS.paused, ['reconcile-invocation']);
    assert.deepEqual(NEXT_ACTIONS.validating, ['validate']);
    assert.deepEqual(NEXT_ACTIONS.validation_failed, ['retry-or-block']);
    assert.deepEqual(NEXT_ACTIONS.planning_ready, [
      'index:code-graph',
      'index:intel',
      'index:knowledge',
      'activate',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------
const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe('ids', () => {
  it('ulid is 26 Crockford characters and matches known vectors', () => {
    const zeros = new Uint8Array(10);
    assert.equal(ulid(0, zeros), '00000000000000000000000000');
    assert.equal(ulid(1, zeros), '00000000010000000000000000');
    assert.equal(ulid(32, zeros), '00000000100000000000000000');
    assert.equal(ulid(2 ** 48 - 1, new Uint8Array(10).fill(0xff)), '7ZZZZZZZZZZZZZZZZZZZZZZZZZ');
    const sample = ulid(1_762_041_600_000, Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    assert.match(sample, CROCKFORD);
  });

  it('ulid sorts by time, then by random bytes', () => {
    const rnd = new Uint8Array(10).fill(0xff);
    const a = ulid(1_000, rnd);
    const b = ulid(1_001, new Uint8Array(10));
    assert.ok(a < b, 'later time must sort later even with smaller random part');
    const c = ulid(1_000, new Uint8Array(10));
    assert.ok(c < a);
  });

  it('ulid rejects out-of-range time and wrong random length', () => {
    assert.throws(() => ulid(-1, new Uint8Array(10)), RangeError);
    assert.throws(() => ulid(2 ** 48, new Uint8Array(10)), RangeError);
    assert.throws(() => ulid(1.5, new Uint8Array(10)), RangeError);
    assert.throws(() => ulid(1, new Uint8Array(9)), RangeError);
    assert.throws(() => ulid(1, new Uint8Array(11)), RangeError);
  });

  it('newId prefixes proj_, onb_, run_, inv_, att_ and ckp_ onto a ULID', () => {
    const rnd = new Uint8Array(10);
    for (const p of ['proj_', 'onb_', 'run_', 'inv_', 'att_', 'ckp_'] as const) {
      const id = newId(p, 5, rnd);
      assert.ok(id.startsWith(p), id);
      assert.equal(id.slice(p.length), ulid(5, rnd));
    }
  });
});

// ---------------------------------------------------------------------------
// Digests
// ---------------------------------------------------------------------------
describe('digest', () => {
  it('canonicalJson sorts keys recursively, keeps array order, omits undefined properties', () => {
    assert.equal(
      canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }], z: undefined }),
      '{"a":[2,{"c":2,"d":1}],"b":1}',
    );
  });

  it('sha256Hex matches the FIPS 180 vector for "abc"', () => {
    assert.equal(
      sha256Hex('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('digestOf is equal for the same keys in a different order and starts with sha256:', () => {
    const a = digestOf({ x: 1, y: { p: [1, 2], q: 'z' } });
    const b = digestOf({ y: { q: 'z', p: [1, 2] }, x: 1 });
    assert.equal(a, b);
    assert.match(a, /^sha256:[0-9a-f]{64}$/);
  });

  it('digestOf changes with array order and with values', () => {
    assert.notEqual(digestOf({ a: [1, 2] }), digestOf({ a: [2, 1] }));
    assert.notEqual(digestOf({ a: 1 }), digestOf({ a: 2 }));
  });

  it('digestOf refuses values with no canonical form (NaN, undefined in an array)', () => {
    assert.throws(() => digestOf({ a: Number.NaN }), TypeError);
    assert.throws(() => digestOf({ a: [undefined] }), TypeError);
  });
});

// ---------------------------------------------------------------------------
// Onboarding contract compiler
// ---------------------------------------------------------------------------
function contractInput(request: Record<string, unknown> = {}) {
  return {
    onboardingId: 'onb_01TEST',
    runId: 'run_01TEST',
    projectId: 'proj_test',
    pin: 'git:4f2c9e1',
    preflight: {},
    request,
    nowIso: '2026-11-02T00:00:00.000Z',
  };
}

const FULL_DERIVATION = {
  mode: 'full',
  mapAgents: 4,
  mapRounds: 2,
  knowledgeAllowance: 10,
  intelAgents: 0,
  total: 18,
  formula: '4 map agents (full) x 2 map rounds (1 + 1 retry) + 10 knowledge (ceil(200 documents / 20 per subagent)) + 0 intel = 18',
};

// Deferred item 11 (plan 01-19): the flat preset of 7 subagents could not hold a full map (4) and its one retry (4 more). The total
// derives from the mapping mode: map agents for the mode x (1 + map retries) + the knowledge pass allowance + intel's 0.
describe('the subagent budget derives from the mapping mode', () => {
  const total = (request: Record<string, unknown>) => unwrap(compileOnboardingContract(contractInput(request))).budgets;
  const derivation = (request: Record<string, unknown>) => (total(request) as unknown as { subagentsDerivation: unknown }).subagentsDerivation;

  it('full (and the default): 4 x 2 + 10 + 0 = 18, recorded with its formula', () => {
    assert.equal(total({}).subagentsTotal, 18);
    assert.equal(total({ mode: 'full' }).subagentsTotal, 18);
    assert.deepEqual(derivation({}), FULL_DERIVATION);
  });

  it('fast: one mapper, so 1 x 2 + 10 + 0 = 12', () => {
    assert.equal(total({ mode: 'fast' }).subagentsTotal, 12);
    assert.deepEqual(derivation({ mode: 'fast' }), {
      mode: 'fast',
      mapAgents: 1,
      mapRounds: 2,
      knowledgeAllowance: 10,
      intelAgents: 0,
      total: 12,
      formula: '1 map agents (fast) x 2 map rounds (1 + 1 retry) + 10 knowledge (ceil(200 documents / 20 per subagent)) + 0 intel = 12',
    });
  });

  it('skip and adopt map nothing (0 map agents): only the knowledge allowance remains, 10; paths needs the full set, 18', () => {
    assert.equal(total({ mode: 'skip' }).subagentsTotal, 10);
    assert.equal(total({ mode: 'adopt' }).subagentsTotal, 10);
    assert.equal(total({ mode: 'paths' }).subagentsTotal, 18);
  });

  it('a retry override changes the rounds: no retry is one round, 4 x 1 + 10 = 14 (fast 11)', () => {
    assert.equal(total({ budgetOverrides: { retry: 0 } }).subagentsTotal, 14);
    assert.equal(total({ mode: 'fast', budgetOverrides: { retry: 0 } }).subagentsTotal, 11);
    assert.equal((derivation({ budgetOverrides: { retry: 0 } }) as { mapRounds: number }).mapRounds, 1);
  });

  it('keeps subagentsConcurrent at 4 in every mode', () => {
    for (const mode of ['full', 'fast', 'skip', 'adopt', 'paths']) assert.equal(total({ mode }).subagentsConcurrent, 4, mode);
  });

  it('a budget override can only lower the derived total: below and at it is used, above it is refused, per mode', () => {
    assert.equal(total({ budgetOverrides: { subagentsTotal: 5 } }).subagentsTotal, 5);
    assert.equal(total({ budgetOverrides: { subagentsTotal: 18 } }).subagentsTotal, 18);
    assert.equal(total({ mode: 'fast', budgetOverrides: { subagentsTotal: 12 } }).subagentsTotal, 12);
    assert.deepEqual(derivation({ budgetOverrides: { subagentsTotal: 5 } }), FULL_DERIVATION, 'the record keeps the derived total, not the override');
    for (const [mode, above] of [['full', 19], ['fast', 13], ['skip', 11], ['adopt', 11]] as const) {
      const r = compileOnboardingContract(contractInput({ mode, budgetOverrides: { subagentsTotal: above } }));
      assert.equal(r.ok, false, `${mode} ${above}`);
      if (!r.ok && r.error.kind === 'invalid') {
        assert.equal(r.error.field, 'request.budgetOverrides.subagentsTotal');
        assert.match(r.error.reason, new RegExp(`budgets can only be lowered: ${above} is above the ${above - 1} derived for mapping mode ${mode}`));
      }
    }
  });

  it('refuses a total above the derived one for a lowered retry too (the ceiling follows the contract\'s own rounds)', () => {
    const r = compileOnboardingContract(contractInput({ budgetOverrides: { retry: 0, subagentsTotal: 15 } }));
    assert.equal(r.ok, false);
  });
});

describe('compileOnboardingContract', () => {
  it('default body carries the onboarding preset values from repository-onboarding.md', () => {
    const c = unwrap(compileOnboardingContract(contractInput()));
    assert.equal(c.schema, 1);
    assert.equal(c.contractVersion, 1);
    assert.equal(c.policyPreset, 'onboarding');
    assert.equal(c.policyRevision, digestOf(ONBOARDING_PRESET));
    assert.deepEqual(c.files.read, ['**']);
    assert.deepEqual(c.files.write.map, ['.planning/codebase/**']);
    assert.deepEqual(c.files.write.intel, ['.planning/intel/**']);
    assert.deepEqual(c.files.write.knowledge, ['.avarice-knowledge/**']);
    assert.deepEqual(c.files.avariceWrite, ['.planning/config.json', '.planning/graphs/**']);
    assert.deepEqual(c.files.delete, []);
    assert.deepEqual(c.execution.endpoints, []);
    assert.equal(c.delivery.promote, 'none');
    assert.equal(c.runId, 'run_01TEST');
    assert.equal(c.workspace.projectId, 'proj_test');
    assert.equal(c.workspace.baseRevision, 'git:4f2c9e1');
  });

  it('default budgets are the research defaults and the existing-map answer is refresh', () => {
    const c = unwrap(compileOnboardingContract(contractInput()));
    assert.deepEqual(c.budgets, {
      wallClockMinutes: 45,
      wallClockShares: { map: 20, intel: 10, knowledge: 15 },
      invocations: 4,
      toolCalls: 600,
      subagentsConcurrent: 4,
      subagentsTotal: 18,
      subagentsDerivation: FULL_DERIVATION,
      costUsd: { perInvocation: 3.0, perRun: 12.0, exactness: 'estimated' },
      retry: 1,
    });
    assert.equal(c.execution.model, 'haiku');
    assert.deepEqual(c.indexes, { codeGraph: true, intel: true, knowledge: true });
    assert.ok(
      c.decisions.defaults.some(
        (d: { class: string; default: string }) => d.class === 'existing-map' && d.default === 'refresh',
      ),
    );
  });

  it('execution.commands are read-only inspection commands only (ONB-4)', () => {
    const c = unwrap(compileOnboardingContract(contractInput()));
    for (const banned of ['npm', 'npx', 'node', 'git commit', 'git push', 'bash', 'sh', 'curl', 'rm']) {
      assert.ok(
        !c.execution.commands.some((cmd: string) => cmd === banned || cmd.startsWith(`${banned} `)),
        `command list must not allow ${banned}`,
      );
    }
    for (const needed of ['ls', 'cat', 'head', 'wc', 'find', 'git ls-files', 'git log', 'git rev-parse']) {
      assert.ok(c.execution.commands.includes(needed), `missing ${needed}`);
    }
  });

  it('refuses any requested promotion other than none (RC-5)', () => {
    for (const promote of ['copy', 'commit', '', 'NONE', 'none ']) {
      const r = compileOnboardingContract(contractInput({ promote }));
      assert.equal(r.ok, false, JSON.stringify(promote));
      if (!r.ok) assert.equal(r.error.kind, 'invalid');
    }
    assert.equal(compileOnboardingContract(contractInput({ promote: 'none' })).ok, true);
    assert.equal(compileOnboardingContract(contractInput({})).ok, true);
  });

  it('accepts a budget override at or below the preset and uses it', () => {
    const lowered = unwrap(compileOnboardingContract(contractInput({ budgetOverrides: { toolCalls: 300 } })));
    assert.equal(lowered.budgets.toolCalls, 300);
    assert.equal(lowered.budgets.invocations, 4);
    const equal = unwrap(compileOnboardingContract(contractInput({ budgetOverrides: { toolCalls: 600 } })));
    assert.equal(equal.budgets.toolCalls, 600);
  });

  it('refuses a budget override above the preset with "budgets can only be lowered"', () => {
    for (const overrides of [
      { toolCalls: 999999 },
      { toolCalls: 601 },
      { invocations: 5 },
      { wallClockMinutes: 46 },
      { subagentsTotal: 19 },
      { costUsdPerInvocation: 3.01 },
      { costUsdPerRun: 12.5 },
    ]) {
      const r = compileOnboardingContract(contractInput({ budgetOverrides: overrides }));
      assert.equal(r.ok, false, JSON.stringify(overrides));
      if (!r.ok) {
        assert.equal(r.error.kind, 'invalid');
        if (r.error.kind === 'invalid') assert.match(r.error.reason, /budgets can only be lowered/);
      }
    }
  });

  it('refuses unknown, negative and non-finite budget overrides', () => {
    for (const overrides of [{ bogus: 1 }, { toolCalls: -1 }, { toolCalls: Number.NaN }, { toolCalls: '5' }]) {
      const r = compileOnboardingContract(contractInput({ budgetOverrides: overrides }));
      assert.equal(r.ok, false, JSON.stringify(overrides));
      if (!r.ok) assert.equal(r.error.kind, 'invalid');
    }
  });

  it('lowering the wall clock scales the per-purpose shares so they never exceed it', () => {
    const c = unwrap(compileOnboardingContract(contractInput({ budgetOverrides: { wallClockMinutes: 30 } })));
    const { map, intel, knowledge } = c.budgets.wallClockShares;
    assert.equal(c.budgets.wallClockMinutes, 30);
    assert.ok(map + intel + knowledge <= 30, `${map}+${intel}+${knowledge}`);
    assert.ok(map > 0 && intel > 0 && knowledge > 0);
  });

  it('records the requested mapping mode, defaults to full and refuses an unknown mode', () => {
    assert.equal(unwrap(compileOnboardingContract(contractInput())).mapping.mode, 'full');
    assert.equal(unwrap(compileOnboardingContract(contractInput({ mode: 'fast' }))).mapping.mode, 'fast');
    const r = compileOnboardingContract(contractInput({ mode: 'everything' }));
    assert.equal(r.ok, false);
  });

  it('folds preflight exclusions and ADR directories in, and refuses unsafe paths', () => {
    const ok1 = unwrap(
      compileOnboardingContract({
        ...contractInput(),
        preflight: { excludedDirectories: ['third_party'], adrDirectories: ['architecture/decisions'] },
      }),
    );
    assert.ok(ok1.files.readExclude.includes('third_party'));
    assert.ok(ok1.files.readExclude.includes('node_modules'));
    assert.ok(ok1.knowledge.documents.includes('docs/**/*.md'));
    assert.ok(ok1.knowledge.documents.includes('architecture/decisions/**/*.md'));
    for (const bad of ['../outside', '/etc', 'a/../../b']) {
      const r = compileOnboardingContract({
        ...contractInput(),
        preflight: { excludedDirectories: [bad] },
      });
      assert.equal(r.ok, false, bad);
    }
  });

  it('contractDigest is deterministic and changes when any budget changes', () => {
    const a = unwrap(compileOnboardingContract(contractInput()));
    const b = unwrap(compileOnboardingContract(contractInput()));
    const c = unwrap(compileOnboardingContract(contractInput({ budgetOverrides: { toolCalls: 599 } })));
    assert.equal(contractDigest(a), contractDigest(b));
    assert.equal(contractDigest(a), digestOf(a));
    assert.notEqual(contractDigest(a), contractDigest(c));
    assert.match(contractDigest(a), /^sha256:[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// Mapping and validation
// ---------------------------------------------------------------------------
const SEVEN = [
  'STACK',
  'ARCHITECTURE',
  'STRUCTURE',
  'CONVENTIONS',
  'TESTING',
  'INTEGRATIONS',
  'CONCERNS',
].map((n) => `.planning/codebase/${n}.md`);
const FOUR = ['STACK', 'INTEGRATIONS', 'ARCHITECTURE', 'STRUCTURE'].map((n) => `.planning/codebase/${n}.md`);
const HEAD = '4f2c9e1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('mapping', () => {
  it('names the seven full-map files and the four fast-map files', () => {
    assert.deepEqual([...FULL_MAP_FILES].sort(), [...SEVEN].sort());
    assert.deepEqual([...FAST_MAP_FILES].sort(), [...FOUR].sort());
  });

  it('completenessFor never claims whole-repository coverage for a partial map (ONB-7)', () => {
    assert.equal(completenessFor('full'), 'complete');
    assert.equal(completenessFor('fast'), 'partial');
    assert.equal(completenessFor('paths'), 'partial');
    assert.equal(completenessFor('skip'), 'none');
  });
});

describe('validateMapArtifacts', () => {
  // Presence and stamp are judged here; the other checks have their own file (validation.test.ts), so the
  // documents are minimal but well-formed and nothing else changed in staging.
  const TEMPLATE: Record<string, string[]> = {
    'STACK.md': ['Languages', 'Runtime', 'Frameworks', 'Key Dependencies', 'Configuration', 'Platform Requirements'],
    'ARCHITECTURE.md': ['Pattern Overview', 'Layers', 'Data Flow', 'Key Abstractions', 'Entry Points', 'Error Handling', 'Cross-Cutting Concerns'],
  };
  const factsOf = (stagingHead: string, files: ReadonlyArray<{ path: string; lastMappedCommit: string | null }>): MapArtifactFacts => ({
    stagingHead,
    files: files.map((f) => {
      const text = ['# Doc', '', ...(TEMPLATE[f.path.split('/').pop() ?? ''] ?? []).map((h) => `## ${h}\n`)].join('\n');
      return { ...f, text, bytes: text.length };
    }),
    changes: { modified: [], added: [], deleted: [] },
    allowedWrite: ['.planning/codebase/**'],
    trackedWritable: ['.planning/codebase/**'],
    knownPaths: [],
  });
  const stamped = (paths: readonly string[], commit: string | null = HEAD) =>
    paths.map((path) => ({ path, lastMappedCommit: commit }));

  it('accepts seven files stamped with the staging HEAD in full mode', () => {
    const v = validateMapArtifacts(factsOf(HEAD, stamped(SEVEN)), { mode: 'full' });
    assert.equal(v.accepted, true);
    assert.ok(v.checks.length >= 2);
    assert.ok(v.checks.every((c) => c.passed));
  });

  it('accepts four files in fast mode and rejects the same four in full mode', () => {
    const files = stamped(FOUR);
    assert.equal(validateMapArtifacts(factsOf(HEAD, files), { mode: 'fast' }).accepted, true);
    const full = validateMapArtifacts(factsOf(HEAD, files), { mode: 'full' });
    assert.equal(full.accepted, false);
    assert.equal(full.checks.find((c) => c.name === 'presence')?.passed, false);
  });

  it('rejects a missing file and names the presence check and the file', () => {
    const v = validateMapArtifacts(factsOf(HEAD, stamped(SEVEN.slice(1))), { mode: 'full' });
    assert.equal(v.accepted, false);
    const presence = v.checks.find((c) => c.name === 'presence');
    assert.equal(presence?.passed, false);
    assert.match(presence?.detail ?? '', /STACK\.md/);
  });

  it('rejects one stale stamp and names the stamp check and the file', () => {
    const files = stamped(SEVEN);
    files[3] = { path: files[3]!.path, lastMappedCommit: 'deadbeef' };
    const v = validateMapArtifacts(factsOf(HEAD, files), { mode: 'full' });
    assert.equal(v.accepted, false);
    const stamp = v.checks.find((c) => c.name === 'stamp');
    assert.equal(stamp?.passed, false);
    assert.match(stamp?.detail ?? '', /CONVENTIONS\.md/);
    assert.equal(v.checks.find((c) => c.name === 'presence')?.passed, true);
  });

  it('rejects a missing stamp, and an empty stamp that equals an empty HEAD', () => {
    const none = validateMapArtifacts(
      factsOf(HEAD, stamped(SEVEN, null)),
      { mode: 'full' },
    );
    assert.equal(none.accepted, false);
    assert.equal(none.checks.find((c) => c.name === 'stamp')?.passed, false);
    const empty = validateMapArtifacts(factsOf('', stamped(SEVEN, '')), { mode: 'full' });
    assert.equal(empty.accepted, false);
    assert.equal(empty.checks.find((c) => c.name === 'stamp')?.passed, false);
  });

  it('accepts the git: prefixed and bare forms of the same commit', () => {
    const v = validateMapArtifacts(
      factsOf(`git:${HEAD}`, stamped(SEVEN)),
      { mode: 'full' },
    );
    assert.equal(v.accepted, true);
  });

  it('ignores extra files and does not require stamps on them', () => {
    const files = [...stamped(SEVEN), { path: '.planning/codebase/NOTES.md', lastMappedCommit: null }];
    assert.equal(validateMapArtifacts(factsOf(HEAD, files), { mode: 'full' }).accepted, true);
  });
});

// ---------------------------------------------------------------------------
// Project record
// ---------------------------------------------------------------------------
function recordInput(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'proj_test',
    recordVersion: 1,
    repository: { rootCommit: 'git:0a1b2c3', remote: 'github.com/example/api', defaultBranch: 'main' },
    onboardedAt: 'git:4f2c9e1',
    profile: 'personal-local',
    stagingPath: '/work/onb_01/staging',
    codebase: [
      { path: '.planning/codebase/STRUCTURE.md', digest: 'sha256:91fe', lastMappedCommit: 'git:4f2c9e1' },
    ],
    snapshot: 'sha256:5d0a',
    mapping: { mode: 'fast' as const, scope: ['.'], mappedAt: '2026-11-02T00:00:00Z' },
    notMapped: ['uncommitted changes in src/a.ts'],
    ...overrides,
  };
}

describe('project record', () => {
  it('builds the spec body: schema 1, promotion none, preset routine, staging location', () => {
    const r = buildProjectRecord(recordInput());
    assert.equal(r.schema, 1);
    assert.equal(r.recordVersion, 1);
    assert.equal(r.projectId, 'proj_test');
    assert.equal(r.promotion, 'none');
    assert.equal(r.policyPreset, 'routine');
    assert.equal(r.artifacts.location, 'staging');
    assert.equal(r.artifacts.stagingPath, '/work/onb_01/staging');
    assert.equal(r.artifacts.snapshot, 'sha256:5d0a');
    assert.deepEqual(r.artifacts.codebase, [
      { path: '.planning/codebase/STRUCTURE.md', digest: 'sha256:91fe', lastMappedCommit: 'git:4f2c9e1' },
    ]);
    assert.deepEqual(r.revisions, { onboardedAt: 'git:4f2c9e1', active: 'git:4f2c9e1' });
    assert.equal(r.gsd.version, 'unknown');
    assert.deepEqual(r.indexes, {});
    assert.deepEqual(r.commands, []);
    assert.equal(r.profile, 'personal-local');
    assert.deepEqual(r.repository, { rootCommit: 'git:0a1b2c3', remote: 'github.com/example/api', defaultBranch: 'main' });
  });

  it('takes mapping.completeness from the mode and notMapped from the input', () => {
    const fast = buildProjectRecord(recordInput());
    assert.equal(fast.mapping.mode, 'fast');
    assert.equal(fast.mapping.completeness, completenessFor('fast'));
    assert.equal(fast.mapping.completeness, 'partial');
    assert.deepEqual(fast.notMapped, ['uncommitted changes in src/a.ts']);
    const full = buildProjectRecord(
      recordInput({ mapping: { mode: 'full', scope: ['.'], mappedAt: '2026-11-02T00:00:00Z' } }),
    );
    assert.equal(full.mapping.completeness, 'complete');
  });

  it('default paths and execution can only narrow authority: no write paths, no endpoints, no credentials', () => {
    const r = buildProjectRecord(recordInput());
    assert.deepEqual(r.paths.write, []);
    assert.deepEqual(r.execution.endpoints, []);
    assert.deepEqual(r.execution.credentials, []);
  });

  it('recordDigest is the same for the same record regardless of key order', () => {
    const r = buildProjectRecord(recordInput());
    const reordered = Object.fromEntries(Object.entries(r).reverse());
    assert.equal(recordDigest(r), recordDigest(reordered));
    assert.match(recordDigest(r), /^sha256:[0-9a-f]{64}$/);
  });

  it('recordDigest changes when notMapped or the snapshot changes', () => {
    const base = recordDigest(buildProjectRecord(recordInput()));
    assert.notEqual(base, recordDigest(buildProjectRecord(recordInput({ notMapped: [] }))));
    assert.notEqual(base, recordDigest(buildProjectRecord(recordInput({ snapshot: 'sha256:other' }))));
  });
});
