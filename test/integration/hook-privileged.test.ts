// Privileged shell forms at the hook (plan 04-19; FR-12, FR-14, S-4, S-7; threats T-04-50, T-04-52, T-04-53). The real hook entry runs as a child process against a
// temp ledger: a privileged form is named by its action, denied with the rule `privileged:<action>` and the command that approves it, and recorded as a
// `policy.denied` and an `approval.requested` event in the same transaction as the decision. No test calls a model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

import { paramsDigest } from '../../src/domain/approval.ts';
import { classifyCommandLine, classifyShellCommand } from '../../src/domain/privileged-commands.ts';
import { PREAMBLE, budgetUsed, chainIsIntact, eventRows, makeHookFixture, runHook } from '../helpers/hook-fixture.ts';
import type { HookFixture } from '../helpers/hook-fixture.ts';

const fixtures: HookFixture[] = [];
function fixture(options: Parameters<typeof makeHookFixture>[0] = {}): HookFixture {
  const fx = makeHookFixture(options);
  fixtures.push(fx);
  return fx;
}
after(() => {
  for (const fx of fixtures) rmSync(fx.dir, { recursive: true, force: true });
});

interface Deny {
  hookSpecificOutput: { hookEventName: string; permissionDecision: string; permissionDecisionReason: string };
}
const parsed = (stdout: string): Deny => JSON.parse(stdout) as Deny;
const dataOf = (row: { data_json: string }): Record<string, unknown> => JSON.parse(row.data_json) as Record<string, unknown>;
const bash = (command: string): { tool_name: string; tool_input: { command: string } } => ({ tool_name: 'Bash', tool_input: { command } });

describe('the classification table (FR-12)', () => {
  const classes = (command: string): [string, Record<string, string>] | null => {
    const found = classifyCommandLine(command);
    return found === null ? null : [found.action, found.params];
  };

  it('names git push by its remote and refspec, whatever way the command is spelled', () => {
    const expected: [string, Record<string, string>] = ['git.push', { remote: 'origin', refspec: 'main' }];
    for (const command of [
      'git push origin main',
      'git -C . push origin main',
      'git -C /tmp/x -c user.name=x push origin main',
      'git --no-pager push origin main',
      'git --git-dir=/tmp/x/.git push origin main',
      'env git push origin main',
      'env -i FOO=1 git push origin main',
      'FOO=1 BAR=2 git push origin main',
      '/usr/bin/git push origin main',
      'GIT push origin main',
      'command git push origin main',
      'sudo -u root git push origin main',
      "git 'push' origin main",
      'cd /tmp/x && git push origin main',
      'echo ok; git push origin main',
      'npm test || git push origin main',
      'echo done | git push origin main',
      'echo $(git push origin main)',
      'echo "$(git push origin main)"',
      'echo `git push origin main`',
      '(git push origin main)',
      '{ git push origin main; }',
      'if true; then git push origin main; fi',
    ]) {
      assert.deepEqual(classes(command), expected, command);
    }
    assert.deepEqual(classes('git push\nls'), ['git.push', {}]);
  });

  it('binds the options a push changes its effect with, by name', () => {
    assert.deepEqual(classes('git push --force origin main'), ['git.push', { options: '--force', refspec: 'main', remote: 'origin' }]);
    assert.deepEqual(classes('git push -u --force-with-lease=main:abc origin main'), ['git.push', { options: '--force-with-lease -u', refspec: 'main', remote: 'origin' }]);
    assert.deepEqual(classes('git push -o ci.skip origin main'), ['git.push', { options: '-o', refspec: 'main', remote: 'origin' }]);
    assert.notDeepEqual(classes('git push origin main'), classes('git push --force origin main'));
  });

  it('names the gh forms, binding the target and leaving the title and body out', () => {
    assert.deepEqual(classes('gh pr create --title x --body y --base main --head feature'), ['scm.pr.create', { base: 'main', head: 'feature', options: '--body --title' }]);
    assert.deepEqual(classes('gh pr create -B main -H f -R o/r -t "a b"'), ['scm.pr.create', { base: 'main', head: 'f', options: '-t', repo: 'o/r' }]);
    assert.deepEqual(classes('gh pr merge 12 --squash --delete-branch'), ['scm.pr.merge', { options: '--delete-branch --squash', selector: '12' }]);
    assert.deepEqual(classes('gh pr edit 12 --add-label x --base dev'), ['scm.pr.update', { base: 'dev', options: '--add-label', selector: '12' }]);
    assert.deepEqual(classes('gh release create v1.2.0 --target main --notes hi'), ['release.publish', { options: '--notes', tag: 'v1.2.0', target: 'main' }]);
  });

  it('names gh api only for a method that is not GET, and treats a request with fields as the POST gh makes of it', () => {
    assert.deepEqual(classes('gh api repos/o/r/pulls -X POST'), ['scm.api.write', { endpoint: 'repos/o/r/pulls', method: 'POST' }]);
    assert.deepEqual(classes('gh api --method=DELETE repos/o/r/git/refs/heads/x'), ['scm.api.write', { endpoint: 'repos/o/r/git/refs/heads/x', method: 'DELETE' }]);
    assert.deepEqual(classes('gh api repos/o/r/issues -f title=x'), ['scm.api.write', { endpoint: 'repos/o/r/issues', method: 'POST', options: '-f' }]);
    assert.deepEqual(classes('gh api graphql -F query=@q.graphql'), ['scm.api.write', { endpoint: 'graphql', method: 'POST', options: '-F' }]);
    assert.deepEqual(classes('gh api repos/o/r/issues -X patch -f state=closed'), ['scm.api.write', { endpoint: 'repos/o/r/issues', method: 'PATCH', options: '-f' }]);
    assert.equal(classes('gh api repos/o/r/pulls'), null);
    assert.equal(classes('gh api -X GET repos/o/r/pulls'), null);
    assert.equal(classes('gh api repos/o/r/pulls --jq .[].number'), null);
  });

  it('names npm publish', () => {
    assert.deepEqual(classes('npm publish'), ['release.publish', {}]);
    assert.deepEqual(classes('npm --prefix pkg publish --access public --tag next'), ['release.publish', { access: 'public', options: '--prefix', tag: 'next' }]);
    assert.deepEqual(classes('npm publish ./pkg.tgz'), ['release.publish', { package: './pkg.tgz' }]);
  });

  it('does not name a command that only mentions a privileged form, or one that reads', () => {
    for (const command of [
      'gh pr view 12',
      'gh pr list',
      'gh issue view 3',
      'git status',
      'git log --grep push',
      'git stash push',
      'git commit -m "git push"',
      'git remote add push x',
      'echo "git push origin main"',
      "echo 'gh pr create'",
      'grep push file.txt',
      'cat gh',
      'npm test',
      'npm install publish',
      'npm view publish',
      'ls',
      '',
    ]) {
      assert.equal(classes(command), null, command);
    }
  });

  it('classifyShellCommand takes the words of one command', () => {
    assert.deepEqual(classifyShellCommand(['git', 'push', 'origin', 'main']), { action: 'git.push', params: { remote: 'origin', refspec: 'main' } });
    assert.equal(classifyShellCommand(['git', 'status']), null);
    assert.equal(classifyShellCommand([]), null);
  });
});

describe('tracer: in a run, gh pr create is denied as privileged with the approve hint and recorded (FR-12, S-7)', () => {
  const fx = fixture();
  const call = bash('gh pr create --title "x" --base main');
  let requestId = '';

  it('denies with rule privileged:scm.pr.create and a reason that names `avarice approve apr_...`', () => {
    const result = runHook(fx, 'pre', call);
    assert.equal(result.code, 0, result.stderr);
    const out = parsed(result.stdout);
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    const reason = out.hookSpecificOutput.permissionDecisionReason;
    assert.match(reason, /^avarice: privileged:scm\.pr\.create: /);
    const named = /avarice approve (apr_[0-9A-Z]{26})/.exec(reason);
    assert.ok(named, reason);
    requestId = named[1] as string;
    assert.equal(budgetUsed(fx, 'toolCalls'), 0, 'a denied call is not charged');
  });

  it('records policy.denied and approval.requested beside the hook.decision, with the scope, the action and the digest of the parsed parameters', () => {
    const decisions = eventRows(fx, 'hook.decision').map(dataOf);
    assert.deepEqual(decisions.map((d) => [d['decision'], d['rule']]), [['deny', 'privileged:scm.pr.create']]);

    const requested = eventRows(fx, 'approval.requested');
    assert.equal(requested.length, 1);
    const [row] = requested;
    assert.ok(row);
    assert.equal(row.run_id, 'run_1');
    const data = dataOf(row);
    assert.equal(data['requestId'], requestId);
    assert.equal(data['scope'], 'run_1');
    assert.equal(data['action'], 'scm.pr.create');
    assert.equal(data['paramsDigest'], paramsDigest({ base: 'main', options: '--title' }));
    assert.equal(data['ruleId'], 'privileged:scm.pr.create');

    const denied = eventRows(fx, 'policy.denied');
    assert.equal(denied.length, 1);
    const [deniedRow] = denied;
    assert.ok(deniedRow);
    assert.equal(deniedRow.run_id, 'run_1');
    assert.equal(deniedRow.invocation_id, 'inv_1');
    const d = dataOf(deniedRow);
    assert.equal(d['ruleId'], 'privileged:scm.pr.create');
    assert.equal(d['action'], 'scm.pr.create');
    assert.equal(d['runId'], 'run_1');
    assert.equal(d['requestId'], requestId);
    assert.ok(chainIsIntact(fx.ledgerPath));
  });

  it('records no command text beyond the bounded target', () => {
    const all = eventRows(fx).map((r) => r.data_json).join('\n');
    assert.ok(!all.includes('gh pr create'), 'the command line is not an event field');
    assert.ok(!all.includes('--title "x"'), 'the title is not an event field');
  });

  it('a retry of the same call names the request that is still waiting and records no second request', () => {
    const again = runHook(fx, 'pre', call);
    assert.equal(again.code, 0, again.stderr);
    assert.ok(parsed(again.stdout).hookSpecificOutput.permissionDecisionReason.includes(`avarice approve ${requestId}`));
    assert.equal(eventRows(fx, 'approval.requested').length, 1);
    assert.equal(eventRows(fx, 'policy.denied').length, 2, 'every denial is recorded');
  });

  it('other parameters are another request', () => {
    const other = runHook(fx, 'pre', bash('gh pr create --base release'));
    const named = /avarice approve (apr_[0-9A-Z]{26})/.exec(parsed(other.stdout).hookSpecificOutput.permissionDecisionReason);
    assert.ok(named);
    assert.notEqual(named[1], requestId);
    assert.equal(eventRows(fx, 'approval.requested').length, 2);
  });
});

describe('a run keeps its prefix rules for what is not privileged (the existing rules are unchanged)', () => {
  const fx = fixture();

  it('gh pr view is still refused by the denied prefix, and git status is still allowed', () => {
    const view = runHook(fx, 'pre', bash('gh pr view 12'));
    assert.match(parsed(view.stdout).hookSpecificOutput.permissionDecisionReason, /shell-denied-prefix/);
    const status = runHook(fx, 'pre', bash('git status'));
    assert.equal(status.code, 0, status.stderr);
    assert.equal(status.stdout, '');
    assert.equal(eventRows(fx, 'approval.requested').length, 0);
    assert.equal(eventRows(fx, 'policy.denied').length, 0);
  });

  it('git push, in each spelling the hook parses, is the privileged action git.push', () => {
    for (const command of ['git push origin main', 'git -C . push origin main', 'env git push origin main']) {
      const result = runHook(fx, 'pre', bash(command));
      assert.equal(result.code, 0, result.stderr);
      assert.match(parsed(result.stdout).hookSpecificOutput.permissionDecisionReason, /^avarice: privileged:git\.push: /, command);
    }
  });

  it('a call that carries the GSD preamble and then a push is judged on the push', () => {
    const result = runHook(fx, 'pre', bash(`${PREAMBLE}\ngit push origin main`));
    assert.match(parsed(result.stdout).hookSpecificOutput.permissionDecisionReason, /privileged:git\.push/);
  });
});
