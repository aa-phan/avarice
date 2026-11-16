// Action classification and the ranked policy evaluator (FR-12, SEC-4, FR-14, D-17). The organization fixture is the reserved `acme` package.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyAction } from '../../src/domain/action-class.ts';
import { INVALID_ORGANIZATION_RULE_ID, evaluatePolicy, parsePolicyFile, parsedAs, policySources } from '../../src/domain/policy.ts';
import type { PolicyFile, PolicySources } from '../../src/domain/policy.ts';
import { readOrganizationPolicy, readRepositoryPolicy } from '../../src/adapters/fs/policy-sources.ts';
import { REPO_ROOT } from '../helpers/run-cli.ts';
import { makeScratchRepo } from '../helpers/scratch-repo.ts';

const FIXTURE = join(REPO_ROOT, 'test', 'fixtures', 'org-acme');
const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function parsed(text: string, source: 'organization' | 'user' | 'repository'): PolicyFile {
  const result = parsePolicyFile(text, source);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

const rulesOf = (source: 'organization' | 'user' | 'repository', ...rules: Array<Record<string, unknown>>): PolicyFile => parsed(JSON.stringify({ schema: 1, rules }), source);
const orgFile = (): PolicyFile => parsed(readFileSync(join(FIXTURE, 'policy.json'), 'utf8'), 'organization');
const userAllowPush = (): PolicyFile => rulesOf('user', { id: 'user.allow-push', action: 'git.push', effect: 'allow' });
const org = (file: PolicyFile = orgFile()): PolicySources['organization'] => ({ ok: true, value: file });

describe('tracer: git.push is privileged and the organization deny wins over a user allow', () => {
  it('classifies git.push as privileged, workspace.write as local-write, context.retrieve as read and an unknown name as privileged', () => {
    assert.equal(classifyAction('git.push'), 'privileged');
    assert.equal(classifyAction('workspace.write'), 'local-write');
    assert.equal(classifyAction('context.retrieve'), 'read');
    assert.equal(classifyAction('made.up'), 'privileged');
  });

  it("returns the organization's deny for git.push on a protected branch even when the user allows it", () => {
    const decision = evaluatePolicy({ profileClass: 'enterprise', organization: org(), user: userAllowPush() }, 'git.push', { branch: 'protected' });
    assert.deepEqual(decision, { effect: 'deny', ruleId: 'org.no-push-protected', rank: 1 });
  });

  it('falls to the built-in require-approval rule when no organization file applies', () => {
    const decision = evaluatePolicy({ profileClass: 'enterprise', user: userAllowPush() }, 'git.push', { branch: 'protected' });
    assert.deepEqual(decision, { effect: 'require-approval', ruleId: 'builtin.privileged-needs-approval', rank: 2 });
  });
});

describe('the built-in defaults (rank 2)', () => {
  it('allows read and local-write actions and requires approval for every privileged one', () => {
    assert.deepEqual(evaluatePolicy({ profileClass: 'personal' }, 'repo.read', {}), { effect: 'allow', ruleId: 'builtin.read-allowed', rank: 2 });
    assert.deepEqual(evaluatePolicy({ profileClass: 'personal' }, 'workspace.write', {}), { effect: 'allow', ruleId: 'builtin.local-write-allowed', rank: 2 });
    for (const action of ['git.push', 'scm.pr.merge', 'release.publish', 'made.up']) {
      assert.deepEqual(evaluatePolicy({ profileClass: 'personal' }, action, {}), { effect: 'require-approval', ruleId: 'builtin.privileged-needs-approval', rank: 2 }, action);
    }
  });

  it('denies the three SEC-5 actions and no file loosens them, at any rank or profile', () => {
    const allowAll = (source: 'organization' | 'user' | 'repository'): PolicyFile =>
      rulesOf(source, ...['net.insecure-transport', 'net.unauthenticated', 'net.egress-unlisted'].map((action, i) => ({ id: `x.allow-${i}`, action, effect: 'allow' })));
    for (const profileClass of ['personal', 'enterprise'] as const) {
      const sources: PolicySources = { profileClass, organization: org(allowAll('organization')), user: allowAll('user'), repository: allowAll('repository') };
      assert.deepEqual(evaluatePolicy(sources, 'net.insecure-transport', {}), { effect: 'deny', ruleId: 'sec5.tls', rank: 2 });
      assert.deepEqual(evaluatePolicy(sources, 'net.unauthenticated', {}), { effect: 'deny', ruleId: 'sec5.authentication', rank: 2 });
      assert.deepEqual(evaluatePolicy(sources, 'net.egress-unlisted', {}), { effect: 'deny', ruleId: 'sec5.egress', rank: 2 });
    }
  });
});

describe('a rule applies by action and by exact parameter values', () => {
  it('does not apply the organization deny to another branch or when the parameter is missing', () => {
    const sources: PolicySources = { profileClass: 'enterprise', organization: org() };
    assert.equal(evaluatePolicy(sources, 'git.push', { branch: 'feature' }).ruleId, 'builtin.privileged-needs-approval');
    assert.equal(evaluatePolicy(sources, 'git.push', {}).ruleId, 'builtin.privileged-needs-approval');
    assert.equal(evaluatePolicy(sources, 'git.push', { branch: 'Protected' }).ruleId, 'builtin.privileged-needs-approval');
  });

  it('applies the organization approval rule and the conditional export deny', () => {
    const sources: PolicySources = { profileClass: 'enterprise', organization: org() };
    assert.deepEqual(evaluatePolicy(sources, 'scm.pr.create', {}), { effect: 'require-approval', ruleId: 'org.pr-needs-approval', rank: 1 });
    assert.deepEqual(evaluatePolicy(sources, 'export', { targetClass: 'personal' }), { effect: 'deny', ruleId: 'org.no-export', rank: 1 });
    assert.equal(evaluatePolicy(sources, 'export', { targetClass: 'enterprise' }).ruleId, 'builtin.privileged-needs-approval');
  });

  it('lets the same rule file produce the same answer however the rules are ordered within a rank', () => {
    const deny = { id: 'user.deny', action: 'scm.pr.create', effect: 'deny' };
    const approve = { id: 'user.approve', action: 'scm.pr.create', effect: 'require-approval' };
    for (const rules of [[deny, approve], [approve, deny]]) {
      const decision = evaluatePolicy({ profileClass: 'personal', user: rulesOf('user', ...rules) }, 'scm.pr.create', {});
      assert.deepEqual(decision, { effect: 'deny', ruleId: 'user.deny', rank: 3 });
    }
  });
});

describe('loosening rules (SEC-4)', () => {
  it('lets a personal profile user rule allow loosen the built-in require-approval', () => {
    const user = rulesOf('user', { id: 'user.allow-pr', action: 'scm.pr.create', effect: 'allow' });
    assert.deepEqual(evaluatePolicy({ profileClass: 'personal', user }, 'scm.pr.create', {}), { effect: 'allow', ruleId: 'user.allow-pr', rank: 3 });
  });

  it('ignores the same user allow under an enterprise profile', () => {
    const user = rulesOf('user', { id: 'user.allow-pr', action: 'scm.pr.create', effect: 'allow' });
    assert.deepEqual(evaluatePolicy({ profileClass: 'enterprise', user }, 'scm.pr.create', {}), { effect: 'require-approval', ruleId: 'builtin.privileged-needs-approval', rank: 2 });
  });

  it('lets a user rule restrict under an enterprise profile', () => {
    const user = rulesOf('user', { id: 'user.no-pr', action: 'scm.pr.create', effect: 'deny' });
    assert.deepEqual(evaluatePolicy({ profileClass: 'enterprise', user }, 'scm.pr.create', {}), { effect: 'deny', ruleId: 'user.no-pr', rank: 3 });
  });

  it('adds a restriction from the repository policy under an enterprise profile and wins over the built-in default', () => {
    const repository = rulesOf('repository', { id: 'repo.no-export', action: 'export', effect: 'deny' });
    assert.deepEqual(evaluatePolicy({ profileClass: 'enterprise', repository }, 'export', {}), { effect: 'deny', ruleId: 'repo.no-export', rank: 4 });
  });

  it('never lets the repository policy loosen, even under a personal profile', () => {
    const repository = rulesOf('repository', { id: 'repo.allow-push', action: 'git.push', effect: 'allow' }, { id: 'repo.allow-read', action: 'repo.read', effect: 'allow' });
    for (const profileClass of ['personal', 'enterprise'] as const) {
      assert.deepEqual(evaluatePolicy({ profileClass, repository }, 'git.push', {}), { effect: 'require-approval', ruleId: 'builtin.privileged-needs-approval', rank: 2 });
    }
  });

  it('lets the repository restrict a personal user allow', () => {
    const user = rulesOf('user', { id: 'user.allow-push', action: 'git.push', effect: 'allow' });
    const repository = rulesOf('repository', { id: 'repo.no-push', action: 'git.push', effect: 'deny' });
    assert.deepEqual(evaluatePolicy({ profileClass: 'personal', user, repository }, 'git.push', {}), { effect: 'deny', ruleId: 'repo.no-push', rank: 4 });
  });

  it('never lets a personal user allow loosen a rule the organization states', () => {
    const user = rulesOf('user', { id: 'user.allow-pr', action: 'scm.pr.create', effect: 'allow' });
    assert.deepEqual(evaluatePolicy({ profileClass: 'personal', organization: org(), user }, 'scm.pr.create', {}), { effect: 'require-approval', ruleId: 'org.pr-needs-approval', rank: 1 });
  });

  it('keeps an organization allow but lets a lower rank restrict it', () => {
    const allow = org(rulesOf('organization', { id: 'org.allow-pr', action: 'scm.pr.create', effect: 'allow' }));
    assert.deepEqual(evaluatePolicy({ profileClass: 'enterprise', organization: allow }, 'scm.pr.create', {}), { effect: 'allow', ruleId: 'org.allow-pr', rank: 1 });
    const repository = rulesOf('repository', { id: 'repo.no-pr', action: 'scm.pr.create', effect: 'deny' });
    assert.deepEqual(evaluatePolicy({ profileClass: 'enterprise', organization: allow, repository }, 'scm.pr.create', {}), { effect: 'deny', ruleId: 'repo.no-pr', rank: 4 });
  });

  it('lets the organization loosen a built-in default', () => {
    const allow = org(rulesOf('organization', { id: 'org.allow-pr', action: 'scm.pr.create', effect: 'allow' }));
    assert.deepEqual(evaluatePolicy({ profileClass: 'enterprise', organization: allow }, 'scm.pr.create', {}), { effect: 'allow', ruleId: 'org.allow-pr', rank: 1 });
  });
});

describe('an invalid or missing rank-1 file (SEC-4, D-17)', () => {
  const invalidText = readFileSync(join(FIXTURE, 'policy-invalid.json'), 'utf8');

  it('parses the invalid fixture as an error', () => {
    const result = parsePolicyFile(invalidText, 'organization');
    assert.equal(result.ok, false);
  });

  for (const [label, organization] of [
    ['absent', 'absent' as const],
    ['invalid', parsePolicyFile(invalidText, 'organization')],
  ] as const) {
    it(`denies every privileged action under an enterprise profile when the organization file is ${label}`, () => {
      const user = rulesOf('user', { id: 'user.allow-all', action: 'git.push', effect: 'allow' });
      for (const action of ['git.push', 'scm.pr.create', 'export', 'made.up', 'net.egress-unlisted']) {
        const decision = evaluatePolicy({ profileClass: 'enterprise', organization, user }, action, {});
        assert.equal(decision.effect, 'deny', action);
        assert.equal(decision.rank, action === 'net.egress-unlisted' ? 2 : 1, action);
        assert.equal(decision.ruleId, action === 'net.egress-unlisted' ? 'sec5.egress' : INVALID_ORGANIZATION_RULE_ID, action);
      }
    });

    it(`still allows read and local-write actions when the organization file is ${label}`, () => {
      assert.deepEqual(evaluatePolicy({ profileClass: 'enterprise', organization }, 'repo.read', {}), { effect: 'allow', ruleId: 'builtin.read-allowed', rank: 2 });
      assert.deepEqual(evaluatePolicy({ profileClass: 'enterprise', organization }, 'workspace.write', {}), { effect: 'allow', ruleId: 'builtin.local-write-allowed', rank: 2 });
    });

    it(`still lets lower ranks restrict when the organization file is ${label}`, () => {
      const repository = rulesOf('repository', { id: 'repo.no-read', action: 'repo.read', effect: 'deny' });
      assert.deepEqual(evaluatePolicy({ profileClass: 'enterprise', organization, repository }, 'repo.read', {}), { effect: 'deny', ruleId: 'repo.no-read', rank: 4 });
    });
  }

  it('does not deny under a personal profile that has no organization file, but does when a given file is broken', () => {
    assert.equal(evaluatePolicy({ profileClass: 'personal' }, 'git.push', {}).ruleId, 'builtin.privileged-needs-approval');
    const broken = parsePolicyFile(invalidText, 'organization');
    assert.equal(evaluatePolicy({ profileClass: 'personal', organization: broken }, 'git.push', {}).ruleId, INVALID_ORGANIZATION_RULE_ID);
  });

  it('keeps a valid organization file in force and does not apply the invalid-file rule', () => {
    const decision = evaluatePolicy({ profileClass: 'enterprise', organization: org() }, 'git.push', { branch: 'feature' });
    assert.equal(decision.ruleId, 'builtin.privileged-needs-approval');
  });
});

describe('parsePolicyFile', () => {
  const rule = { id: 'x.rule', action: 'git.push', effect: 'deny' };

  it('parses the organization fixture and remembers the source it was parsed as', () => {
    const file = orgFile();
    assert.equal(file.schema, 1);
    assert.deepEqual(file.rules.map((r) => r.id), ['org.no-push-protected', 'org.pr-needs-approval', 'org.no-export']);
    assert.equal(file.rules[1]?.approvalSource, 'local-user');
    assert.equal(parsedAs(file), 'organization');
    assert.equal(Object.isFrozen(file) && Object.isFrozen(file.rules) && Object.isFrozen(file.rules[0]), true);
  });

  it('accepts an already parsed value as well as text', () => {
    assert.equal(parsePolicyFile({ schema: 1, rules: [rule] }, 'user').ok, true);
  });

  const refused: Array<[string, unknown]> = [
    ['text that is not JSON', '{not json'],
    ['a list', []],
    ['a null', null],
    ['an unknown top-level key', { schema: 1, rules: [], extra: true }],
    ['a schema other than 1', { schema: 2, rules: [] }],
    ['no schema', { rules: [] }],
    ['rules that are not a list', { schema: 1, rules: {} }],
    ['a rule that is not an object', { schema: 1, rules: ['x'] }],
    ['an unknown rule key', { schema: 1, rules: [{ ...rule, comment: 'x' }] }],
    ['an unknown effect', { schema: 1, rules: [{ ...rule, effect: 'permit' }] }],
    ['no effect', { schema: 1, rules: [{ id: 'x.r', action: 'git.push' }] }],
    ['a rule id with a capital', { schema: 1, rules: [{ ...rule, id: 'X.rule' }] }],
    ['a rule id that repeats', { schema: 1, rules: [rule, rule] }],
    ['an action with a space', { schema: 1, rules: [{ ...rule, action: 'git push' }] }],
    ['an empty when', { schema: 1, rules: [{ ...rule, when: {} }] }],
    ['a when value that is not a string', { schema: 1, rules: [{ ...rule, when: { branch: true } }] }],
    ['a when key that is not a name', { schema: 1, rules: [{ ...rule, when: { 'a b': 'x' } }] }],
    ['an approvalSource on a deny', { schema: 1, rules: [{ ...rule, approvalSource: 'local-user' }] }],
    ['an approvalSource that is not a name', { schema: 1, rules: [{ ...rule, effect: 'require-approval', approvalSource: 'Local User' }] }],
    ['more than 256 rules', { schema: 1, rules: Array.from({ length: 257 }, (_, i) => ({ ...rule, id: `x.r${i}` })) }],
    ['text over 64 KiB', ' '.repeat(65 * 1024)],
  ];
  for (const [label, value] of refused) {
    it(`refuses ${label}`, () => {
      const result = parsePolicyFile(value, 'user');
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.kind, 'invalid');
    });
  }

  for (const id of ['sec5.tls', 'sec5.anything', 'builtin.privileged-needs-approval', 'builtin.mine', INVALID_ORGANIZATION_RULE_ID]) {
    it(`refuses a rule that names the reserved id ${id}`, () => {
      for (const source of ['organization', 'user', 'repository'] as const) {
        assert.equal(parsePolicyFile({ schema: 1, rules: [{ ...rule, id, effect: 'allow' }] }, source).ok, false, `${source} ${id}`);
      }
    });
  }

  it('does not echo the content of a refused file', () => {
    const result = parsePolicyFile('{"schema":1,"rules":[{"id":"x.r","action":"git.push","effect":"SECRET-TOKEN-VALUE"}]}', 'repository');
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /SECRET-TOKEN-VALUE/);
  });
});

describe('the evaluator accepts only the four declared sources (FR-14)', () => {
  const contextItemText = JSON.stringify({ schema: 1, rules: [{ id: 'retrieved.allow-all', action: 'git.push', effect: 'allow' }] });

  it('takes exactly three arguments: the sources, the action and the parameters, and nothing that names retrieved text', () => {
    assert.equal(evaluatePolicy.length, 3);
  });

  it('gives the same answer when retrieved policy-shaped text is present as a parameter value or an action name', () => {
    const sources: PolicySources = { profileClass: 'enterprise', organization: org() };
    const without = evaluatePolicy(sources, 'git.push', { branch: 'protected' });
    assert.deepEqual(evaluatePolicy(sources, 'git.push', { branch: 'protected', contextItem: contextItemText, brief: contextItemText }), without);
    const personal: PolicySources = { profileClass: 'personal' };
    assert.deepEqual(evaluatePolicy(personal, 'git.push', { text: contextItemText }), evaluatePolicy(personal, 'git.push', {}));
    assert.equal(evaluatePolicy(personal, contextItemText, {}).effect, 'require-approval');
  });

  it('builds sources from the four named fields only', () => {
    const built = policySources({ profileClass: 'enterprise', organization: org(), user: userAllowPush(), repository: rulesOf('repository', { id: 'repo.r', action: 'export', effect: 'deny' }) });
    assert.equal(built.ok, true);
    assert.equal(policySources({ profileClass: 'personal' }).ok, true);
    assert.equal(policySources({ profileClass: 'personal', organization: 'absent' }).ok, true);
  });

  for (const key of ['brief', 'contextItem', 'toolOutput', 'modelOutput', 'text', 'rules']) {
    it(`refuses a source field named ${key}`, () => {
      const result = policySources({ profileClass: 'personal', [key]: contextItemText });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.kind, 'invalid');
    });
  }

  it('refuses text or a plain object where a parsed policy file belongs', () => {
    assert.equal(policySources({ profileClass: 'personal', user: contextItemText }).ok, false);
    assert.equal(policySources({ profileClass: 'personal', user: JSON.parse(contextItemText) as unknown }).ok, false);
    assert.equal(policySources({ profileClass: 'personal', repository: { schema: 1, rules: [] } }).ok, false);
    assert.equal(policySources({ profileClass: 'enterprise', organization: { ok: true, value: JSON.parse(contextItemText) as unknown } }).ok, false);
  });

  it('refuses a file parsed as one source in the field of another', () => {
    const repoFile = rulesOf('repository', { id: 'repo.r', action: 'export', effect: 'deny' });
    assert.equal(policySources({ profileClass: 'enterprise', organization: org(repoFile) }).ok, false);
    assert.equal(policySources({ profileClass: 'personal', user: repoFile }).ok, false);
    assert.equal(policySources({ profileClass: 'personal', repository: userAllowPush() }).ok, false);
  });

  it('refuses a profile class that is not personal or enterprise', () => {
    assert.equal(policySources({ profileClass: 'admin' }).ok, false);
    assert.equal(policySources({}).ok, false);
  });
});

describe('readOrganizationPolicy', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-policy-')));
  cleanup.push(dir);

  it('reads the fixture organization file as a rank-1 source', () => {
    const result = readOrganizationPolicy(join(FIXTURE, 'policy.json'));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.rules.length, 3);
    assert.equal(parsedAs(result.value), 'organization');
  });

  it('resolves the fixture profile config to that same file', () => {
    const config = JSON.parse(readFileSync(join(FIXTURE, 'config.json'), 'utf8')) as { policy: { organizationFile: string }; profile: { id: string; class: string } };
    assert.deepEqual(config.profile, { id: 'enterprise-acme', class: 'enterprise' });
    assert.equal(readOrganizationPolicy(join(FIXTURE, config.policy.organizationFile)).ok, true);
  });

  it('answers not_found for a missing file', () => {
    const result = readOrganizationPolicy(join(dir, 'nope.json'));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, 'not_found');
  });

  it('refuses the invalid fixture', () => {
    const result = readOrganizationPolicy(join(FIXTURE, 'policy-invalid.json'));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, 'invalid');
  });

  it('refuses a symbolic link, even to a valid file', () => {
    const link = join(dir, 'link.json');
    symlinkSync(join(FIXTURE, 'policy.json'), link);
    const result = readOrganizationPolicy(link);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, 'invalid');
  });

  it('refuses a directory and a file over 64 KiB', () => {
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    assert.equal(readOrganizationPolicy(sub).ok, false);
    const big = join(dir, 'big.json');
    writeFileSync(big, JSON.stringify({ schema: 1, rules: [], pad: 'x'.repeat(64 * 1024) }));
    const result = readOrganizationPolicy(big);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, 'invalid');
  });

  it('refuses text that is not JSON', () => {
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{nope');
    assert.equal(readOrganizationPolicy(bad).ok, false);
  });
});

describe('readRepositoryPolicy reads git objects at the pin', () => {
  const committed = JSON.stringify({ schema: 1, rules: [{ id: 'repo.no-export', action: 'export', effect: 'deny' }] });
  const loosened = JSON.stringify({ schema: 1, rules: [{ id: 'repo.allow-export', action: 'export', effect: 'allow' }] });

  it('returns the committed rules and ignores an uncommitted working-tree edit', () => {
    const repo = makeScratchRepo({ files: { 'README.md': '# x\n', '.avarice/policy.json': committed }, modified: { '.avarice/policy.json': loosened } });
    cleanup.push(repo.base);
    assert.equal(readFileSync(join(repo.path, '.avarice', 'policy.json'), 'utf8'), loosened);
    const result = readRepositoryPolicy(repo.path, repo.head);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok || result.value === null) return assert.fail('a policy file was committed');
    assert.deepEqual(result.value.rules.map((r) => r.id), ['repo.no-export']);
    assert.equal(parsedAs(result.value), 'repository');
    const decision = evaluatePolicy({ profileClass: 'enterprise', repository: result.value }, 'export', {});
    assert.deepEqual(decision, { effect: 'deny', ruleId: 'repo.no-export', rank: 4 });
  });

  it('ignores an untracked policy file and answers null when the pin has none', () => {
    const repo = makeScratchRepo({ files: { 'README.md': '# x\n' }, untracked: { '.avarice/policy.json': loosened } });
    cleanup.push(repo.base);
    assert.deepEqual(readRepositoryPolicy(repo.path, repo.head), { ok: true, value: null });
  });

  it('reads the policy of the pin, not of a later commit', () => {
    const repo = makeScratchRepo({ files: { 'README.md': '# x\n', '.avarice/policy.json': committed }, commits: [{ '.avarice/policy.json': loosened }] });
    cleanup.push(repo.base);
    const first = readRepositoryPolicy(repo.path, repo.shas[0] as string);
    const second = readRepositoryPolicy(repo.path, repo.shas[1] as string);
    assert.equal(first.ok && first.value?.rules[0]?.id, 'repo.no-export');
    assert.equal(second.ok && second.value?.rules[0]?.id, 'repo.allow-export');
  });

  it('refuses a committed file that is invalid, a pin that is not a full SHA and a pin that is not in the repository', () => {
    const repo = makeScratchRepo({ files: { 'README.md': '# x\n', '.avarice/policy.json': '{"schema":1,"rules":[{"id":"r","action":"x","effect":"permit"}]}' } });
    cleanup.push(repo.base);
    const invalid = readRepositoryPolicy(repo.path, repo.head);
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.equal(invalid.error.kind, 'invalid');
    assert.equal(readRepositoryPolicy(repo.path, 'HEAD').ok, false);
    assert.equal(readRepositoryPolicy(repo.path, '--output=x').ok, false);
    assert.equal(readRepositoryPolicy(repo.path, 'a'.repeat(40)).ok, false);
  });

  it('refuses a committed policy file that is a symbolic link', () => {
    const link = makeScratchRepoWithLink();
    cleanup.push(link.base);
    const result = readRepositoryPolicy(link.path, link.head);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, 'invalid');
  });
});

function makeScratchRepoWithLink(): ReturnType<typeof makeScratchRepo> {
  // A committed symbolic link is a blob of mode 120000 whose content is the link target; the scratch helper writes regular files, so the
  // link is committed with plumbing.
  const repo = makeScratchRepo({ files: { 'README.md': '# x\n' } });
  const blob = gitIn(repo.path, ['hash-object', '-w', '--stdin'], '../README.md').trim();
  const tree = gitIn(repo.path, ['mktree'], `100644 blob ${gitIn(repo.path, ['rev-parse', 'HEAD:README.md']).trim()}\tREADME.md\n040000 tree ${emptyDirTree(repo.path, blob)}\t.avarice\n`).trim();
  const commit = gitIn(repo.path, ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit-tree', tree, '-p', repo.head, '-m', 'link'], '').trim();
  return { ...repo, head: commit, shas: [...repo.shas, commit] };
}

function emptyDirTree(cwd: string, linkBlob: string): string {
  return gitIn(cwd, ['mktree'], `120000 blob ${linkBlob}\tpolicy.json\n`).trim();
}

function gitIn(cwd: string, args: string[], input?: string): string {
  const run = spawnSync('git', args, { cwd, input, encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: tmpdir(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout;
}
