// The action classification table (FR-12): every action is read, local-write or privileged, and a name outside the table is privileged.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_CLASSES, classifyAction } from '../../src/domain/action-class.ts';

const PRIVILEGED = [
  'git.push',
  'scm.pr.create',
  'scm.pr.update',
  'scm.pr.merge',
  'scm.api.write',
  'scm.comment.create',
  'tracker.write',
  'release.publish',
  'deploy',
  'export',
  'onboarding.promote.copy',
  'onboarding.promote.commit',
];
const LOCAL_WRITE = ['workspace.write', 'staging.write', 'artifact.store', 'handoff.local-branch'];
const READ = ['context.retrieve', 'repo.read', 'status.read'];

describe('ACTION_CLASSES (FR-12)', () => {
  it('gives every entry one of the three classes', () => {
    assert.ok(Object.keys(ACTION_CLASSES).length >= PRIVILEGED.length + LOCAL_WRITE.length + READ.length);
    for (const [name, cls] of Object.entries(ACTION_CLASSES)) {
      assert.ok(['read', 'local-write', 'privileged'].includes(cls), `${name}: ${cls}`);
    }
  });

  it('lists every action that leaves the machine or changes a shared system as privileged', () => {
    for (const name of PRIVILEGED) assert.equal(ACTION_CLASSES[name], 'privileged', name);
  });

  it('classes the local-write and read actions', () => {
    for (const name of LOCAL_WRITE) assert.equal(ACTION_CLASSES[name], 'local-write', name);
    for (const name of READ) assert.equal(ACTION_CLASSES[name], 'read', name);
  });

  it('is frozen, so no caller can add or reclass an action at run time', () => {
    assert.equal(Object.isFrozen(ACTION_CLASSES), true);
    assert.throws(() => {
      (ACTION_CLASSES as Record<string, string>)['git.push'] = 'read';
    }, TypeError);
    assert.equal(classifyAction('git.push'), 'privileged');
  });
});

describe('classifyAction', () => {
  it('returns the class of a named action', () => {
    assert.equal(classifyAction('context.retrieve'), 'read');
    assert.equal(classifyAction('workspace.write'), 'local-write');
    assert.equal(classifyAction('git.push'), 'privileged');
  });

  it('returns privileged for a name that is not in the table, including names that look like inherited properties', () => {
    for (const name of ['made.up', '', 'constructor', 'toString', '__proto__', 'hasOwnProperty', 'Git.Push']) {
      assert.equal(classifyAction(name), 'privileged', JSON.stringify(name));
    }
  });
});
