// Privileged shell forms at the hook (plan 04-19; FR-12, FR-14, S-4, S-7; threats T-04-50, T-04-52, T-04-53). The real hook entry runs as a child process against a
// temp ledger: a privileged form is named by its action, denied with the rule `privileged:<action>` and the command that approves it, and recorded as a
// `policy.denied` and an `approval.requested` event in the same transaction as the decision. No test calls a model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

describe('the classification table (FR-12)', () => {
  const classes = (command: string): [string, Record<string, string>] | null => {
    const found = classifyLine(command);
    const first = found.kind === 'privileged' ? found.commands[0] : undefined;
    return first === undefined ? null : [first.action, first.params];
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

const attendedCall = (command: string, session = 's1'): Record<string, unknown> => ({ session_id: session, hook_event_name: 'PreToolUse', cwd: '/tmp', tool_name: 'Bash', tool_input: { command } });

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
    assert.equal(data['paramsDigest'], paramsDigest({ remote: 'origin', refspec: 'main' }));
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
