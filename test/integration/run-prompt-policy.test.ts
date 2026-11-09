// The unit prompt and the hook policy of the same invocation agree (plan 03-34; the 03-27 diagnosis in spikes/phase-3-wave-0/S3-B-small-unit-haiku.md).
// A small item on haiku did not complete in two live runs because the prompt listed one command, never stated the shell rules and told the unit to run a
// workflow whose own shell steps the hook refuses, and because a refusal named a rule and nothing else. This suite runs a one-item small brief through the real
// supervisor with the fake run host, reads the invocation request the host was given, builds the hook policy from that request's scope exactly as the host does,
// and judges every command the prompt grants with that policy: each one is admitted, and each refused shape the prompt names is refused. No model is called.
import { after, describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalAbsolute } from '../../src/adapters/fs/canonical-path.ts';
import { buildHookPolicy } from '../../src/adapters/host-claude/hook-policy.ts';
import { RUN_SHELL_RULES_SENTENCE, RUN_WORKFLOW_SHELL_SENTENCE } from '../../src/app/run-gsd-config.ts';
import type { BriefItem } from '../../src/domain/brief.ts';
import { decideToolCall, normalizeToolCall } from '../../src/domain/hook-decision.ts';
import type { HookDecision, HookPolicy } from '../../src/domain/hook-decision.ts';
import { PURPOSE_EXTENSIONS, READ_ONLY_COMMANDS } from '../../src/domain/invocation-scope.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import { FIXED_SLUG, RUN_CONVENTIONS_WITH_COMMANDS, commitConventions, makeRunRepo, onboardRunRepo, runInProcess, writeItemsBrief } from '../helpers/run-fixtures.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

interface Played {
  prompt: string;
  cwd: string;
  policy: HookPolicy;
}

const ITEMS: readonly BriefItem[] = [{ id: 'A', title: 'Collapse repeated dashes', dependsOn: [], size: 'small', acceptance: ['AC1'] }];
const ACCEPTANCE: readonly string[] = ['Repeated separators collapse to one dash | verifiedBy: check:test'];

// The one invocation of a one-item small run: the prompt the host was given and the hook policy built from its scope.
async function playSmallItem(): Promise<Played> {
  const roots = makeRoots();
  const repo = makeRunRepo();
  cleanup.push(roots.base, repo.base);
  onboardRunRepo(roots, repo);
  commitConventions(repo, RUN_CONVENTIONS_WITH_COMMANDS);
  const brief = writeItemsBrief(join(roots.base, 'briefs'), ITEMS, ACCEPTANCE);
  const done = await runInProcess(roots, repo, brief, { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' });
  assert.equal(done.host.calls.length, 1, 'one item, one invocation');
  const call = done.host.calls[0];
  assert.ok(call !== undefined);
  const built = buildHookPolicy(
    call.scope,
    { onboardingId: call.onboardingId, runId: call.runId, invocationId: call.invocationId, subagentTypes: [...PURPOSE_EXTENSIONS.run.agents] },
    join(realpathSync(call.scope.dataRoot), 'state.db'),
  );
  assert.ok(built.ok, JSON.stringify(built));
  return { prompt: call.prompt, cwd: realpathSync(call.cwd), policy: built.value };
}

// The commands the prompt grants, read from its own text: the bullets under the command heading and the read-only sentence.
function grantedByPrompt(prompt: string): { contract: string[]; readOnly: string[] } {
  const lines = prompt.split('\n');
  const heading = lines.indexOf('Commands you may run, exactly as written:');
  assert.ok(heading !== -1, 'the prompt has the command heading');
  const contract: string[] = [];
  for (let i = heading + 1; i < lines.length && (lines[i] as string).startsWith('- '); i += 1) contract.push((lines[i] as string).slice(2));
  const sentence = lines.find((line) => /read-only commands/.test(line));
  assert.ok(sentence !== undefined, 'the prompt has the read-only sentence');
  const listed = /repository: (.+?)\. Read files/.exec(sentence)?.[1];
  assert.ok(listed !== undefined, 'the read-only sentence lists its commands');
  return { contract, readOnly: listed.split(', ') };
}

// One plain command with the operand its form needs: relative, inside the repository.
const WITH_OPERAND: Readonly<Record<string, string>> = {
  ls: 'ls src',
  cat: 'cat package.json',
  head: 'head package.json',
  tail: 'tail package.json',
  wc: 'wc package.json',
  find: 'find src',
  'git ls-files': 'git ls-files src',
  'git log': 'git log',
  'git rev-parse': 'git rev-parse HEAD',
  'git status': 'git status',
  'git show': 'git show HEAD:package.json',
};

function judge(played: Played, command: string): HookDecision {
  const normalized = normalizeToolCall('Bash', { command }, played.cwd);
  assert.ok(normalized.ok, JSON.stringify(normalized));
  return decideToolCall(normalized.call, played.policy, canonicalAbsolute);
}

describe('the unit prompt and the hook policy of one invocation (plan 03-34, T-03-64)', () => {
  let played: Played;
  before(async () => {
    played = await playSmallItem();
  });

  it('carries the three shell lines of a small item', () => {
    for (const text of [RUN_SHELL_RULES_SENTENCE, RUN_WORKFLOW_SHELL_SENTENCE]) assert.ok(played.prompt.includes(text));
    assert.match(played.prompt, /read-only commands/);
  });

  it("grants exactly the policy's contract commands and the policy's read-only commands", () => {
    const granted = grantedByPrompt(played.prompt);
    assert.deepEqual(granted.contract, (played.policy.agentCommands ?? []).map((command) => [...command.words, ...(command.paths ? ['<paths>'] : [])].join(' ')));
    assert.deepEqual(granted.readOnly, played.policy.commands.readOnly);
    assert.deepEqual(granted.readOnly, [...READ_ONLY_COMMANDS]);
  });

  it('admits every command the prompt grants, as one plain command with a relative operand', () => {
    const granted = grantedByPrompt(played.prompt);
    assert.ok(granted.contract.includes('npm test'));
    for (const command of granted.contract) assert.equal(judge(played, command).decision, 'allow', command);
    for (const entry of granted.readOnly) {
      const command = WITH_OPERAND[entry];
      assert.ok(command !== undefined, `the suite has no example operand for the read-only command ${entry}`);
      assert.equal(judge(played, command).decision, 'allow', command);
    }
  });

  it('refuses each shape the prompt names: a chained line, a redirection, a home path, pwd and mkdir', () => {
    const refused: Array<[string, string]> = [
      ['ls src; ls test', 'shell-syntax'],
      ['npm test 2>&1', 'shell-syntax'],
      ['ls ~', 'shell-syntax'],
      ['pwd', 'shell-not-allowed'],
      ['mkdir -p .planning/quick/x', 'shell-not-allowed'],
    ];
    for (const [command, rule] of refused) {
      const decision = judge(played, command);
      assert.deepEqual([decision.decision, decision.rule], ['deny', rule], command);
    }
  });
});
