// Gate G1 in the item flow (plan 03-19; D-02, D-07 stage 2, RC-7, AUT-1, T-03-37). After a unit progressed, G1 judges its quick PLAN before G2 does: a path outside the item spec or
// the write set opens a scope_expansion decision whose consequences print the amend command; a plan checkpoint:decision the unit resolved without pausing opens an acceptance
// decision with the plan's options; an owner-choice criterion with no answered decision opens an acceptance decision that allows free text. A plan that cites no acceptance ID passes
// with an advisory (spike S3-A left PLAN_CITES_ACCEPTANCE_HARD false), and a unit that paused is never failed for a plan it did not write. The fake run host plays the units; git,
// the sandboxed checks, the ledger and the gates are real.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { runSupervisor } from '../../src/app/run-service.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { optionsOf } from '../../src/domain/decision-policy.ts';
import { PLAN_CITES_ACCEPTANCE_HARD } from '../../src/domain/gates.ts';
import { FIXED_SLUG, briefWithAcceptance, ledgerRows, profileEnv } from '../helpers/run-fixtures.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { FakeRunHost } from '../helpers/fake-run-host.ts';
import { decisionsOf, itemStatesOf } from '../helpers/independent-work.ts';
import { attemptsDb, checkpointsOf, evidenceOf, gatesOf, runScenario, scenario, stepsOf } from '../helpers/repair-scenarios.ts';
import type { Scenario } from '../helpers/repair-scenarios.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const FIX: FakeRunOptions = { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' };
const BRIEF = briefWithAcceptance('Repeated separators collapse to one dash | verifiedBy: check:test');
const OWNER_BRIEF = briefWithAcceptance('Repeated separators collapse to one dash | verifiedBy: decision:fallback-wording, check:test');

interface Failure {
  rule: string;
  detail: string;
  advisory?: boolean;
}
const failuresOf = (row: { failures_json: string } | undefined): Failure[] => (row === undefined ? [] : (JSON.parse(row.failures_json) as Failure[]));
const g1Of = (s: Scenario, runId: string) => gatesOf(s.roots, runId).filter((g) => g.gate === 'G1');
const contractDigestOf = (s: Scenario, runId: string): string[] => ledgerRows<{ digest: string }>(s.roots, 'SELECT digest FROM contracts WHERE run_id = ? ORDER BY version', runId).map((r) => r.digest);

describe('G1 turns a plan that needs more than its spec into a decision (D-07, T-03-37)', () => {
  it('a plan path outside the write set fails plan-within-write-scope: a scope_expansion decision prints the amend command, the item is parked and G2 never runs', async () => {
    const s = scenario(cleanup, { briefText: BRIEF });
    const ran = await runScenario(s, { ...FIX, planText: '---\nfiles_modified: [src/slug.ts, docs/x.md]\n---\n# Plan\n\nFix the slug and note it in the docs.\n' });
    assert.equal(ran.state, 'blocked_on_decision', `ended ${ran.state} (${ran.reason ?? 'no reason'})`);
    assert.equal(ran.reason, 'decision');
    const [g1] = g1Of(s, ran.runId);
    assert.equal(g1?.passed, 0);
    assert.deepEqual(failuresOf(g1).map((f) => f.rule), ['plan-within-write-scope']);
    assert.match(failuresOf(g1)[0]?.detail ?? '', /docs\/x\.md/);

    const [decision] = decisionsOf(s.roots, ran.runId);
    assert.equal(decisionsOf(s.roots, ran.runId).length, 1);
    assert.equal(decision?.class, 'scope_expansion');
    const consequences = JSON.parse(decision?.consequences_json ?? '{}') as { amend?: { command: string } };
    assert.match(consequences.amend?.command ?? '', new RegExp(`^avarice contract amend ${ran.runId} --decision \\S+ --reason "<why>" --add-write 'docs/x\\.md'$`));
    assert.deepEqual(optionsOf(JSON.parse(decision?.options_json ?? '[]')).map((o) => o.kind), ['withdraw']);

    assert.deepEqual(itemStatesOf(s.roots, ran.runId), [['A', 'blocked_on_decision']]);
    assert.equal(stepsOf(s.roots, ran.runId, 'park').filter((p) => p.status === 'completed').length, 1, "the unit's delta is parked");
    assert.equal(gatesOf(s.roots, ran.runId).filter((g) => g.gate === 'G2').length, 0, 'G2 never ran for that unit');
    assert.equal(evidenceOf(s.roots, ran.runId).filter((e) => e.kind === 'check' && e.environment_json.includes('"label":"g2"')).length, 0, 'no required check ran on the unit');
    assert.deepEqual(attemptsDb(s.roots, ran.runId).map((a) => a.reason), ['initial']);
  });

  it('a checkpoint:decision the unit resolved without pausing opens an acceptance decision with the plan options a and b', async () => {
    const s = scenario(cleanup, { briefText: BRIEF });
    const plan = [
      '# Plan',
      '',
      '<tasks>',
      '<task type="checkpoint:decision" gate="blocking">',
      '  <decision>Which slug style?</decision>',
      '  <options>',
      '    <option id="a"><name>Dashes</name></option>',
      '    <option id="b"><name>Underscores</name></option>',
      '  </options>',
      '</task>',
      '</tasks>',
      '',
    ].join('\n');
    const ran = await runScenario(s, { ...FIX, planText: plan });
    assert.equal(ran.state, 'blocked_on_decision', `ended ${ran.state} (${ran.reason ?? 'no reason'})`);
    const [g1] = g1Of(s, ran.runId);
    assert.deepEqual(failuresOf(g1).map((f) => f.rule), ['decision-checkpoint-unresolved']);
    const [decision] = decisionsOf(s.roots, ran.runId);
    assert.equal(decision?.class, 'acceptance');
    assert.deepEqual(optionsOf(JSON.parse(decision?.options_json ?? '[]')).map((o) => `${o.key}:${o.kind}`), ['a:choice', 'b:choice']);
    assert.equal(gatesOf(s.roots, ran.runId).filter((g) => g.gate === 'G2').length, 0);
  });

  it('a checkpoint:decision with an auto_select does not fail G1', async () => {
    const s = scenario(cleanup, { briefText: BRIEF });
    const plan = '# Plan\n\n<task type="checkpoint:decision" gate="blocking" auto_select="a">\n  <options><option id="a"><name>Dashes</name></option></options>\n</task>\n';
    const ran = await runScenario(s, { ...FIX, planText: plan });
    assert.equal(ran.state, 'ready_for_review', `ended ${ran.state} (${ran.reason ?? 'no reason'})`);
    assert.equal(g1Of(s, ran.runId)[0]?.passed, 1);
  });
});


describe('G1 asks for an owner choice the unit never asked (D-02)', () => {
  it('owner-choice-unasked opens an acceptance decision that allows free text; once it is answered the next unit of the item passes the rule', async () => {
    const s = scenario(cleanup, { briefText: OWNER_BRIEF });
    const ran = await runScenario(s, FIX);
    assert.equal(ran.state, 'blocked_on_decision', `ended ${ran.state} (${ran.reason ?? 'no reason'})`);
    const [g1] = g1Of(s, ran.runId);
    assert.deepEqual(failuresOf(g1).map((f) => f.rule), ['owner-choice-unasked']);
    assert.match(failuresOf(g1)[0]?.detail ?? '', /AC1 \(fallback-wording\)/);
    const [decision] = decisionsOf(s.roots, ran.runId);
    assert.equal(decision?.class, 'acceptance');
    assert.deepEqual(optionsOf(JSON.parse(decision?.options_json ?? '[]')).map((o) => o.kind), ['text'], 'free text (D-02)');
    assert.equal(gatesOf(s.roots, ran.runId).filter((g) => g.gate === 'G2').length, 0);

    // The owner answers; a supervisor takes the run and the item runs again as a fresh unit that passes the rule.
    const host = new FakeRunHost(FIX);
    const composed = createDeps(profileEnv(s.roots), { host });
    assert.ok(composed.ok, 'composition');
    try {
      const answered = composed.value.deps.ledger.answerDecision({ runId: ran.runId, decisionId: decision?.decision_id as string, answer: 'Say "no results yet".', answeredBy: 'owner', channel: 'terminal', expectContractVersion: 1, nowMs: Date.now() });
      assert.ok(answered.ok, JSON.stringify(answered));
      const outcome = await runSupervisor(composed.value.deps, ran.runId);
      assert.ok(outcome.ok, JSON.stringify(outcome));
      assert.equal(outcome.value.state, 'ready_for_review');
    } finally {
      composed.value.close();
    }
    assert.deepEqual(
      g1Of(s, ran.runId).map((g) => g.passed),
      [0, 1],
      'the first unit failed G1, the answered unit passed it',
    );
    assert.deepEqual(attemptsDb(s.roots, ran.runId).map((a) => a.reason), ['initial', 'answer']);
  });
});

describe('G1 reads the plan as data, and never fails what it cannot judge', () => {
  it('a plan that cites no acceptance ID passes G1 with an advisory recorded in the G1 row, while PLAN_CITES_ACCEPTANCE_HARD is false', async () => {
    assert.equal(PLAN_CITES_ACCEPTANCE_HARD, false);
    const s = scenario(cleanup, { briefText: BRIEF });
    const ran = await runScenario(s, { ...FIX, planText: '# Plan\n\nFix the slug.\n' });
    assert.equal(ran.state, 'ready_for_review', `ended ${ran.state} (${ran.reason ?? 'no reason'})`);
    const [g1] = g1Of(s, ran.runId);
    assert.equal(g1?.passed, 1);
    const entries = failuresOf(g1);
    assert.deepEqual(entries.map((f) => [f.rule, f.advisory === true]), [['plan-cites-acceptance', true]]);
  });

  it('a plan that cites the acceptance ID records no advisory', async () => {
    const s = scenario(cleanup, { briefText: BRIEF });
    const ran = await runScenario(s, { ...FIX, planText: '# Plan\n\nFix the slug for AC1.\n' });
    assert.equal(ran.state, 'ready_for_review');
    assert.deepEqual(failuresOf(g1Of(s, ran.runId)[0]), []);
  });

  it('a plan that names symbols, a config key and a reference for an item whose spec was derived: a spec:plan step lists them, and the stored contract is unchanged (RC-7)', async () => {
    const s = scenario(cleanup, { briefText: BRIEF });
    const plan = '# Plan\n\nChange `slugify` and read the `slug.max-length` setting, as docs/slug-rules.md says.\n';
    const ran = await runScenario(s, { ...FIX, planText: plan });
    assert.equal(ran.state, 'ready_for_review', `ended ${ran.state} (${ran.reason ?? 'no reason'})`);
    const [step] = stepsOf(s.roots, ran.runId, 'spec:plan');
    assert.ok(step !== undefined, 'a spec:plan step records what the plan named');
    assert.equal(step.result['derivedFrom'], 'plan');
    assert.equal(step.result['itemId'], 'A');
    assert.deepEqual(step.result['symbols'], ['slugify']);
    assert.deepEqual(step.result['configKeys'], ['slug.max-length']);
    assert.deepEqual(step.result['references'], ['docs/slug-rules.md']);
    assert.equal(contractDigestOf(s, ran.runId).length, 1, 'no contract version was written');
  });

  it('a unit that paused is never failed for the plan it did not write: no G1 row, and the pause is the decision', async () => {
    const s = scenario(cleanup, { briefText: BRIEF });
    const ran = await runScenario(s, { question: 'Which wording?\n1. soft\n2. hard' });
    assert.equal(ran.state, 'blocked_on_decision', `ended ${ran.state} (${ran.reason ?? 'no reason'})`);
    assert.equal(g1Of(s, ran.runId).length, 0, 'G1 judges a unit that progressed');
    const [decision] = decisionsOf(s.roots, ran.runId);
    assert.equal(decision?.class, 'acceptance');
    assert.deepEqual(optionsOf(JSON.parse(decision?.options_json ?? '[]')).map((o) => o.key), ['1', '2']);
  });

  it('judges every progressed unit before G2: the G1 checkpoint comes first, and each G1 row precedes its G2 row', async () => {
    const s = scenario(cleanup, { briefText: BRIEF });
    const ran = await runScenario(s, FIX);
    assert.equal(ran.state, 'ready_for_review');
    const actions = checkpointsOf(s.roots, ran.runId);
    assert.ok(actions.indexOf('gate:g1') !== -1 && actions.indexOf('gate:g1') < actions.indexOf('gate:g2'), actions.join(' '));
    assert.deepEqual(
      gatesOf(s.roots, ran.runId).map((g) => `${g.gate}:${g.passed}`),
      ['G0:1', 'G1:1', 'G2:1', 'G4:1'],
    );
  });
});
