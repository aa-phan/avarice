// Plan 01-10 Task 1: every validation rule of docs/repository-onboarding.md "Validation" through the real CLI,
// ledger, staging and artifact layers with the fake host. A rejected map is remapped once, then blocks with a
// decision (S-36); a secret blocks at once and the document is never stored.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDeps } from '../../src/cli/composition.ts';
import { runOnboarding, startOnboarding } from '../../src/app/onboarding-service.ts';
import type { AgentHost, InvocationOutcome, InvocationRequest } from '../../src/ports/agent-host.ts';
import type { Result } from '../../src/domain/result.ts';
import { REPO_ROOT, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { checkoutSnapshot, makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';
import { FakeAgentHost } from '../helpers/fake-agent-host.ts';
import type { FakeHostOptions } from '../helpers/fake-agent-host.ts';

const TEST_CLI = join(REPO_ROOT, 'test', 'helpers', 'test-cli.ts');
const LIB_FILES = Array.from({ length: 20 }, (_, i) => `lib/f${String(i).padStart(2, '0')}.ts`);
const REPO_FILES: Record<string, string> = {
  'README.md': '# scratch\n',
  'package.json': '{"name":"scratch"}\n',
  ...Object.fromEntries(LIB_FILES.map((f) => [f, `export const x = '${f}';\n`])),
};

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function fixture(): { roots: CliRoots; repo: ScratchRepo } {
  const roots = makeRoots();
  const repo = makeScratchRepo({ files: REPO_FILES });
  cleanup.push(roots.base, repo.base);
  return { roots, repo };
}

function onboard(roots: CliRoots, repo: ScratchRepo, host: FakeHostOptions = {}) {
  return runCli(['onboard', '--policy', 'onboarding', repo.path], { roots, entry: TEST_CLI, env: { AVARICE_FAKE_HOST: JSON.stringify(host) } });
}

function rows<T>(roots: CliRoots, sql: string, ...params: Array<string | number>): T[] {
  const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
  try {
    return (db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    db.close();
  }
}

interface Onboarding {
  state: string;
  reason: string | null;
}

function finalState(roots: CliRoots): Onboarding {
  const [row] = rows<{ state: string; reason: string | null }>(
    roots,
    `SELECT o.state AS state, (SELECT json_extract(e.data_json, '$.reason') FROM events e WHERE e.type = 'onboarding.transition' AND json_extract(e.data_json, '$.to') = o.state ORDER BY e.seq DESC LIMIT 1) AS reason FROM onboardings o`,
  );
  assert.ok(row);
  return row;
}

interface ValidateStep {
  attempt: number;
  status: string;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
}

function validateSteps(roots: CliRoots): ValidateStep[] {
  return rows<{ attempt: number; status: string; result_json: string }>(roots, "SELECT attempt, status, result_json FROM onboarding_steps WHERE step = 'validate' ORDER BY attempt").map((r) => ({
    attempt: r.attempt,
    status: r.status,
    checks: (JSON.parse(r.result_json) as { checks: ValidateStep['checks'] }).checks,
  }));
}

const failedNames = (step: ValidateStep | undefined): string[] => (step?.checks ?? []).filter((c) => !c.passed).map((c) => c.name);

function eventsOfType(roots: CliRoots, type: string): Array<Record<string, unknown>> {
  return rows<{ data_json: string }>(roots, 'SELECT data_json FROM events WHERE type = ? ORDER BY seq', type).map((r) => JSON.parse(r.data_json) as Record<string, unknown>);
}

function injectRefs(paths: readonly string[]): string {
  return paths.map((p) => `- \`${p}\``).join('\n');
}

describe('scope of writes', () => {
  it('fails a file outside the write sets, remaps once, blocks with a decision and emits containment.finding', () => {
    const { roots, repo } = fixture();
    const pristine = checkoutSnapshot(repo.path);
    const r = onboard(roots, repo, { extraWrites: { 'src/evil.ts': 'export {};\n' } });
    assert.equal(r.code, 3, r.stdout + r.stderr);
    assert.deepEqual(finalState(roots), { state: 'blocked', reason: 'decision' });

    const steps = validateSteps(roots);
    assert.equal(steps.length, 2, 'one remap within the retry budget');
    for (const s of steps) {
      assert.equal(s.status, 'rejected');
      assert.deepEqual(failedNames(s), ['scope-of-writes']);
      assert.match(s.checks.find((c) => c.name === 'scope-of-writes')?.detail ?? '', /src\/evil\.ts/);
    }
    assert.equal(rows(roots, "SELECT 1 FROM onboarding_steps WHERE step = 'launch:map'").length, 2);
    assert.equal(rows(roots, 'SELECT 1 FROM attempts').length, 2, 'a new attempts row per rejection');
    assert.equal(rows(roots, "SELECT 1 FROM attempts WHERE reason LIKE 'validation_failed%'").length, 2);

    const findings = eventsOfType(roots, 'containment.finding');
    assert.ok(findings.length >= 1, 'a containment finding is emitted');
    assert.equal(findings[0]?.['check'], 'scope-of-writes');
    assert.deepEqual(findings[0]?.['paths'], ['src/evil.ts']);

    assert.equal(rows(roots, 'SELECT 1 FROM project_records').length, 0);
    assert.deepEqual(checkoutSnapshot(repo.path), pristine, 'the user checkout is untouched');
  });

  it('fails a changed tracked file and an untracked file at the staging root', () => {
    const cases: Array<Record<string, string>> = [{ 'package.json': '{"name":"changed"}\n' }, { 'newroot.txt': 'x\n' }];
    for (const extraWrites of cases) {
      const { roots, repo } = fixture();
      assert.equal(onboard(roots, repo, { extraWrites }).code, 3);
      assert.deepEqual(failedNames(validateSteps(roots)[0]), ['scope-of-writes'], JSON.stringify(extraWrites));
      assert.equal(eventsOfType(roots, 'containment.finding').length >= 1, true);
    }
  });

  it('accepts a change to .planning/config.json and an untracked file under .planning/graphs/', () => {
    const { roots, repo } = fixture();
    const r = onboard(roots, repo, { extraWrites: { '.planning/config.json': '{"commit_docs":false}\n', '.planning/graphs/x.json': '{}\n' } });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(eventsOfType(roots, 'containment.finding').length, 0);
  });
});

describe('path references (S-36)', () => {
  const real = LIB_FILES.slice(0, 18);

  it('ends validation_failed, remaps once, then blocks (decision) when 10% of the named paths do not exist', () => {
    const { roots, repo } = fixture();
    const r = onboard(roots, repo, { inject: injectRefs([...real, 'lib/missing-a.ts', 'lib/missing-b.ts']) });
    assert.equal(r.code, 3, r.stdout + r.stderr);
    assert.deepEqual(finalState(roots), { state: 'blocked', reason: 'decision' });
    const steps = validateSteps(roots);
    assert.equal(steps.length, 2);
    assert.deepEqual(failedNames(steps[0]), ['path-references']);
    assert.match(steps[0]?.checks.find((c) => c.name === 'path-references')?.detail ?? '', /lib\/missing-a\.ts/);
    assert.equal(rows(roots, "SELECT 1 FROM onboarding_steps WHERE step = 'launch:map'").length, 2);
    const blocked = eventsOfType(roots, 'onboarding.transition').find((e) => e['to'] === 'blocked');
    assert.deepEqual(blocked?.['failed'], ['path-references'], 'the blocking event names the failing checks');
  });

  it('activates when exactly 5% dangle', () => {
    const { roots, repo } = fixture();
    const r = onboard(roots, repo, { inject: injectRefs([...real, 'lib/missing-a.ts']) });
    assert.equal(r.code, 0, r.stdout + r.stderr);
  });
});

describe('secrets (T-01-21)', () => {
  const secrets: Array<[string, string]> = [
    ['a GitHub token', `ghp_${'q7Zx'.repeat(9)}`],
    ['an AWS access key', 'AKIAQWERTYUIOPASDFGH'],
    ['a private key header', '-----BEGIN OPENSSH PRIVATE KEY-----'],
    ['a JWT-shaped string', `eyJ${'a'.repeat(15)}.eyJ${'b'.repeat(15)}.${'c'.repeat(15)}`],
  ];

  function filesUnder(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true, recursive: true })
      .filter((e) => e.isFile())
      .map((e) => join(e.parentPath, e.name));
  }

  for (const [name, secret] of secrets) {
    it(`blocks with a decision, no retry and no stored bytes, when a document contains ${name}`, () => {
      const { roots, repo } = fixture();
      const r = onboard(roots, repo, { inject: `credentials: ${secret}` });
      assert.equal(r.code, 3, r.stdout + r.stderr);
      assert.deepEqual(finalState(roots), { state: 'blocked', reason: 'decision' });

      const steps = validateSteps(roots);
      assert.equal(steps.length, 1, 'no retry');
      assert.deepEqual(failedNames(steps[0]), ['secrets']);
      assert.equal(rows(roots, "SELECT 1 FROM onboarding_steps WHERE step = 'launch:map'").length, 1);
      assert.equal(rows(roots, 'SELECT 1 FROM attempts').length, 0);
      assert.equal(rows(roots, 'SELECT 1 FROM artifacts').length, 0, 'no artifact row for any document');
      assert.equal(rows(roots, 'SELECT 1 FROM project_records').length, 0);

      // The secret appears in no file under the data root (ledger, WAL and artifact store alike), and not in stdout.
      for (const file of filesUnder(roots.AVARICE_DATA_ROOT)) {
        if (statSync(file).size === 0) continue;
        assert.equal(readFileSync(file).includes(secret), false, `${file} holds the secret`);
      }
      assert.equal((r.stdout + r.stderr).includes(secret), false);
      const artifactsDir = join(roots.AVARICE_DATA_ROOT, 'artifacts');
      let stored: string[] = [];
      try {
        stored = filesUnder(artifactsDir);
      } catch {
        // No artifact directory at all is the strongest form.
      }
      assert.deepEqual(stored, []);
    });
  }
});

describe('size and structure', () => {
  const stamped = (body: string) => (head: string) => `---\nlast_mapped_commit: ${head}\n---\n${body}`;

  it('rejects an empty document', () => {
    const { roots, repo } = fixture();
    assert.equal(onboard(roots, repo, { rawFiles: { 'CONCERNS.md': '' } }).code, 3);
    assert.ok(failedNames(validateSteps(roots)[0]).includes('size-and-structure') || failedNames(validateSteps(roots)[0]).includes('stamp'));
  });

  it('rejects a document above 256 KiB', () => {
    const { roots, repo } = fixture();
    assert.equal(onboard(roots, repo, { padBytes: 270_000 }).code, 3);
    const first = validateSteps(roots)[0];
    assert.deepEqual(failedNames(first), ['size-and-structure']);
    assert.match(first?.checks.find((c) => c.name === 'size-and-structure')?.detail ?? '', /262144/);
  });

  it('rejects a document with no Markdown heading', () => {
    const { roots, repo } = fixture();
    // The stamp must equal the staging HEAD, which is the repository HEAD the staging worktree was cut at.
    const head = repo.head;
    assert.equal(onboard(roots, repo, { rawFiles: { 'CONVENTIONS.md': stamped('plain prose, no heading at all\n')(head) } }).code, 3);
    const first = validateSteps(roots)[0];
    assert.deepEqual(failedNames(first), ['size-and-structure']);
    assert.match(first?.checks.find((c) => c.name === 'size-and-structure')?.detail ?? '', /CONVENTIONS\.md/);
  });

  it('rejects a STACK.md that lacks a template heading, and an ARCHITECTURE.md likewise', () => {
    for (const [file, heading] of [['STACK.md', 'Key Dependencies'], ['ARCHITECTURE.md', 'Data Flow']] as const) {
      const { roots, repo } = fixture();
      assert.equal(onboard(roots, repo, { omitHeadings: { [file]: [heading] } }).code, 3);
      const first = validateSteps(roots)[0];
      assert.deepEqual(failedNames(first), ['size-and-structure']);
      assert.match(first?.checks.find((c) => c.name === 'size-and-structure')?.detail ?? '', new RegExp(`${file}.*${heading}`));
    }
  });
});

describe('retry', () => {
  // Calls the n-th host of a list for the n-th invocation, so the second mapping can behave differently.
  class SequencedHost implements AgentHost {
    readonly hosts: FakeAgentHost[];
    readonly descriptor = new FakeAgentHost().descriptor;
    calls = 0;
    constructor(options: FakeHostOptions[]) {
      this.hosts = options.map((o) => new FakeAgentHost(o));
    }
    invoke(req: InvocationRequest, signal: AbortSignal): Promise<Result<InvocationOutcome>> {
      const host = this.hosts[Math.min(this.calls, this.hosts.length - 1)] as FakeAgentHost;
      this.calls += 1;
      return host.invoke(req, signal);
    }
  }

  it('re-enters mapping as attempt 2 after the first rejection and activates when the second map is valid', async () => {
    const roots = makeRoots();
    const repo = makeScratchRepo({ files: REPO_FILES });
    cleanup.push(roots.base, repo.base);
    const env = { ...process.env, AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME, AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT, AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT };
    const host = new SequencedHost([{ omit: ['TESTING.md'] }, {}]);
    const composed = createDeps(env, { host });
    assert.ok(composed.ok);
    try {
      const started = startOnboarding(composed.value.deps, { repoPath: repo.path, policy: 'onboarding' });
      assert.ok(started.ok);
      const outcome = await runOnboarding(composed.value.deps, started.value.onboardingId);
      assert.ok(outcome.ok);
      assert.equal(outcome.value.state, 'active');
    } finally {
      composed.value.close();
    }
    assert.equal(host.calls, 2);
    const steps = validateSteps(roots);
    assert.deepEqual(
      steps.map((s) => [s.attempt, s.status]),
      [[1, 'rejected'], [2, 'accepted']],
    );
    assert.deepEqual(failedNames(steps[0]), ['presence']);
    const attempts = rows<{ ordinal: number; reason: string }>(roots, 'SELECT ordinal, reason FROM attempts ORDER BY ordinal');
    assert.equal(attempts.length, 1);
    assert.match(attempts[0]?.reason ?? '', /^validation_failed/);
  });
});
