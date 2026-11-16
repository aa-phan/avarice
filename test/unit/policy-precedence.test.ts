// Action classification and the ranked policy evaluator (FR-12, SEC-4, D-17). The organization fixture is the reserved `acme` package.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyAction } from '../../src/domain/action-class.ts';
import { evaluatePolicy, parsePolicyFile } from '../../src/domain/policy.ts';
import type { PolicyFile } from '../../src/domain/policy.ts';
import { REPO_ROOT } from '../helpers/run-cli.ts';

const FIXTURE = join(REPO_ROOT, 'test', 'fixtures', 'org-acme');

function parsed(text: string, source: 'organization' | 'user' | 'repository'): PolicyFile {
  const result = parsePolicyFile(text, source);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

const orgFile = (): PolicyFile => parsed(readFileSync(join(FIXTURE, 'policy.json'), 'utf8'), 'organization');
const userAllowPush = (): PolicyFile => parsed(JSON.stringify({ schema: 1, rules: [{ id: 'user.allow-push', action: 'git.push', effect: 'allow' }] }), 'user');

describe('tracer: git.push is privileged and the organization deny wins over a user allow', () => {
  it('classifies git.push as privileged, workspace.write as local-write, context.retrieve as read and an unknown name as privileged', () => {
    assert.equal(classifyAction('git.push'), 'privileged');
    assert.equal(classifyAction('workspace.write'), 'local-write');
    assert.equal(classifyAction('context.retrieve'), 'read');
    assert.equal(classifyAction('made.up'), 'privileged');
  });

  it("returns the organization's deny for git.push on a protected branch even when the user allows it", () => {
    const decision = evaluatePolicy({ profileClass: 'enterprise', organization: { ok: true, value: orgFile() }, user: userAllowPush() }, 'git.push', { branch: 'protected' });
    assert.deepEqual(decision, { effect: 'deny', ruleId: 'org.no-push-protected', rank: 1 });
  });

  it('falls to the built-in require-approval rule when no organization file applies', () => {
    const decision = evaluatePolicy({ profileClass: 'enterprise', user: userAllowPush() }, 'git.push', { branch: 'protected' });
    assert.deepEqual(decision, { effect: 'require-approval', ruleId: 'builtin.privileged-needs-approval', rank: 2 });
  });
});
