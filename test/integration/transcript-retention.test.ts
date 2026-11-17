// SEC-3 / D-14 (plan 04-18): the host transcript is redacted line by line before the 20 MiB cap counts it, the cap cuts at a line
// boundary, and a run keeps a redacted summary plus the digest of the redacted transcript by default. The whole transcript is
// stored only when the profile sets retention.transcripts to full or AVARICE_DEBUG_TRANSCRIPTS=1 is set. A fake claude replays the
// stream-json (no model is called); every profile, repository and configuration directory is a temp directory.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { configPathFor } from '../../src/adapters/fs/profile-paths.ts';
import { fingerprintGsdPreamble } from '../../src/adapters/gsd/preamble.ts';
import { locateGsdCore } from '../../src/adapters/gsd/locate.ts';
import { ClaudeHostAdapter } from '../../src/adapters/host-claude/claude-host.ts';
import type { ClaudeHostOptions } from '../../src/adapters/host-claude/claude-host.ts';
import { runOnboarding, startOnboarding } from '../../src/app/onboarding-service.ts';
import type { AppDeps } from '../../src/app/deps.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { sha256Hex } from '../../src/domain/digest.ts';
import { parseRetentionSection } from '../../src/domain/redactor.ts';
import { makeFakeClaude } from '../helpers/fake-claude.ts';
import type { FakeClaude, FakeClaudeScript } from '../helpers/fake-claude.ts';
import { PRODUCTION_ENTRY, REPO_ROOT, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';
import { transcript } from '../fixtures/stream-json.ts';

const REPO_FILES = {
  'README.md': '# scratch\n',
  'package.json': '{"name":"scratch"}\n',
  'src/index.ts': 'export const answer = 42;\n',
};
const HOOK_ENTRY = join(REPO_ROOT, 'src', 'hook', 'pre-tool-use.ts');
const ANY_SESSION = '00000000-0000-4000-8000-000000000000';
// Built from parts so this file holds no complete secret-shaped literal.
const GITHUB_TOKEN = `ghp_${'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'}`;
const DEBUG = 'AVARICE_DEBUG_TRANSCRIPTS';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

interface Setup {
  roots: CliRoots;
  repo: ScratchRepo;
  fake: FakeClaude;
  configDir: string;
}

function setup(script: FakeClaudeScript): Setup {
  const roots = makeRoots();
  const repo = makeScratchRepo({ files: REPO_FILES });
  const fake = makeFakeClaude(script);
  const configDir = join(roots.base, 'claude-config');
  for (const skill of ['gsd-map-codebase', 'graphify']) {
    mkdirSync(join(configDir, 'skills', skill), { recursive: true });
    writeFileSync(join(configDir, 'skills', skill, 'SKILL.md'), `---\nname: ${skill}\ndescription: stand-in\n---\n`);
  }
  cleanup.push(roots.base, repo.base, fake.dir);
  return { roots, repo, fake, configDir };
}

function envFor(s: Setup, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AVARICE_CONFIG_HOME: s.roots.AVARICE_CONFIG_HOME,
    AVARICE_DATA_ROOT: s.roots.AVARICE_DATA_ROOT,
    AVARICE_WORK_ROOT: s.roots.AVARICE_WORK_ROOT,
    AVARICE_CLAUDE_BIN: s.fake.bin,
    CLAUDE_CONFIG_DIR: s.configDir,
    AVARICE_GRAPHIFY_BIN: '/nonexistent',
  };
  delete env[DEBUG];
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

function rows<T>(roots: CliRoots, sql: string, ...params: Array<string | number>): T[] {
  const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
  try {
    return (db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    db.close();
  }
}

function blob(roots: CliRoots, digest: string): string {
  const hex = digest.replace('sha256:', '');
  return readFileSync(join(roots.AVARICE_DATA_ROOT, 'artifacts', hex.slice(0, 2), hex), 'utf8');
}

// The adapter is built here so a test can lower the cap; the rest is the production composition, ledger, staging and stage loop.
async function inProcess(s: Setup, extraEnv: Record<string, string | undefined>, adapterOptions: Partial<ClaudeHostOptions> = {}): Promise<{ deps: AppDeps; state: string }> {
  const env = envFor(s, extraEnv);
  const composed = createDeps(env);
  assert.ok(composed.ok, 'composition');
  const located = locateGsdCore(env);
  assert.ok(located.ok, 'gsd-core is installed');
  const preamble = fingerprintGsdPreamble(located.value.gsdCoreDir);
  assert.ok(preamble.ok, 'the GSD preamble is found');
  const { deps } = composed.value;
  try {
    const adapter = new ClaudeHostAdapter({
      claudeBin: s.fake.bin,
      hookEntry: HOOK_ENTRY,
      ledgerPath: join(deps.profile.dataRoot, 'state.db'),
      dataRoot: deps.profile.dataRoot,
      gsd: { gsdCoreDir: located.value.gsdCoreDir, agentsDir: join(located.value.gsdCoreDir, '..', 'agents'), skillsRoot: join(s.configDir, 'skills'), preamble: preamble.value },
      artifacts: deps.artifacts,
      staging: deps.staging,
      countHookDenies: (id) => deps.ledger.countHookDenials(id),
      env,
      ...adapterOptions,
    });
    const wired: AppDeps = { ...deps, host: adapter };
    const started = startOnboarding(wired, { repoPath: s.repo.path, policy: 'onboarding', mode: 'full' });
    assert.ok(started.ok, 'registration');
    const outcome = await runOnboarding(wired, started.value.onboardingId);
    assert.ok(outcome.ok, 'the onboarding ran');
    return { deps: wired, state: outcome.value.state };
  } finally {
    composed.value.close();
  }
}

function launchResult(roots: CliRoots): Record<string, unknown> {
  const [row] = rows<{ result_json: string }>(roots, "SELECT result_json FROM onboarding_steps WHERE step = 'launch:map' ORDER BY attempt");
  assert.ok(row, 'the map launch step is recorded');
  return JSON.parse(row.result_json) as Record<string, unknown>;
}

// The distinct transcript kinds the onboarding stored (it runs more than one invocation, each with its own summary).
const kindsOf = (roots: CliRoots): string[] => [...new Set(rows<{ kind: string }>(roots, "SELECT kind FROM artifacts WHERE kind IN ('transcript', 'transcript-summary')").map((r) => r.kind))].sort();

// The bytes the host prints before the extra line, so a cap can be placed inside the token that line carries.
function streamPrefixBytes(): number {
  const lines = transcript('success', ANY_SESSION).split('\n');
  const result = lines.findIndex((l) => l.startsWith('{"type":"result"'));
  return Buffer.byteLength(`${lines.slice(0, result).join('\n')}\n`);
}

const tokenLine = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: `the token is ${GITHUB_TOKEN}` }] } });
const tokenAt = tokenLine.indexOf(GITHUB_TOKEN);

// The number of 9-character windows of the token that the text holds (a window is longer than any harmless coincidence).
// Every line kept before the truncation note is a whole JSON line: the cap cut at a line boundary.
function assertWholeLines(stored: string): void {
  const kept = stored.slice(0, stored.indexOf('\n[avarice: transcript truncated'));
  assert.ok(kept.length > 0, 'some lines are kept');
  assert.ok(kept.endsWith('\n'), 'the kept text ends at a line boundary');
  for (const line of kept.split('\n').filter((l) => l !== '')) assert.doesNotThrow(() => JSON.parse(line), `a kept line is whole: ${line.slice(0, 60)}`);
}

function longestTokenFragment(text: string): number {
  let found = 0;
  for (let from = 0; from + 9 <= GITHUB_TOKEN.length; from += 1) {
    if (text.includes(GITHUB_TOKEN.slice(from, from + 9))) found += 1;
  }
  return found;
}

describe('tracer: a secret straddling the cap is redacted, and a default run stores a summary and a digest, not the transcript (SEC-3, D-14)', () => {
  it('redacts a token that the cap would split, and keeps the line it belonged to when the redacted line fits', async () => {
    const s = setup({ transcript: 'success', mapFiles: 'all', extraLines: [tokenLine], chunkBytes: 29 });
    // The cap falls inside the 40-character token of the raw stream; the redacted line is shorter and ends before it.
    const cap = streamPrefixBytes() + tokenAt + 35;
    const run = await inProcess(s, { [DEBUG]: '1' }, { maxTranscriptBytes: cap });
    assert.equal(run.state, 'active', 'the result was parsed from all of the output, not only the kept part');
    const [artifact] = rows<{ digest: string }>(s.roots, "SELECT digest FROM artifacts WHERE kind = 'transcript'");
    assert.ok(artifact, 'a transcript artifact is stored in debug mode');
    const stored = blob(s.roots, artifact.digest);
    assert.ok(stored.includes('[REDACTED:github-token]'), 'the token is reported redacted in its line');
    assert.ok(longestTokenFragment(stored) <= 8, `no part of the token longer than 8 characters is stored (${longestTokenFragment(stored)} windows found)`);
    assert.match(stored, /\[avarice: transcript truncated at \d+ bytes\]/);
    assertWholeLines(stored);
    assert.ok(Buffer.byteLength(stored) < cap + 100, 'the transcript stays within the cap plus the note');
  });

  it('cuts at a line boundary: a line that does not fit even redacted is dropped whole', async () => {
    const s = setup({ transcript: 'success', mapFiles: 'all', extraLines: [tokenLine] });
    const cap = streamPrefixBytes() + 5;
    await inProcess(s, { [DEBUG]: '1' }, { maxTranscriptBytes: cap });
    const [artifact] = rows<{ digest: string }>(s.roots, "SELECT digest FROM artifacts WHERE kind = 'transcript'");
    assert.ok(artifact);
    const stored = blob(s.roots, artifact.digest);
    assert.equal(longestTokenFragment(stored), 0, 'not even the start of the token is stored');
    assert.ok(!stored.includes('the token is'), 'the partial line is not stored');
    assert.match(stored, /\[avarice: transcript truncated at \d+ bytes\]/);
    assertWholeLines(stored);
  });

  it('by default keeps a transcript-summary and the digest of the redacted transcript, and no transcript; the invocation still finishes with its counts', async () => {
    const s = setup({ transcript: 'success', mapFiles: 'all' });
    const run = await inProcess(s, {});
    assert.equal(run.state, 'active');
    assert.deepEqual(kindsOf(s.roots), ['transcript-summary'], 'a summary and no transcript');
    const step = launchResult(s.roots);
    const sessionId = step['sessionId'] as string;
    assert.equal(step['transcriptDigest'], `sha256:${sha256Hex(transcript('success', sessionId))}`, 'the digest of the redacted transcript');
    assert.equal(step['transcript'], undefined, 'no transcript artifact is named');
    const summaryDigest = step['transcriptSummary'];
    assert.equal(typeof summaryDigest, 'string');
    assert.deepEqual(JSON.parse(blob(s.roots, summaryDigest as string)), {
      sessionId,
      turns: 2,
      costUsd: 0.01606839,
      toolUses: { Agent: 1 },
      resultText: 'The scan finished. The documents are in .planning/codebase/.',
    });
    const [finished] = rows<{ data_json: string }>(s.roots, "SELECT data_json FROM events WHERE type = 'invocation.finished'");
    assert.ok(finished, 'an invocation.finished event');
    const data = JSON.parse(finished.data_json) as Record<string, unknown>;
    assert.equal(data['outcome'], 'progressed');
    assert.equal(data['costUsd'], 0.01606839);
    assert.equal(data['numTurns'], 2);
    assert.equal(data['transcriptDigest'], step['transcriptDigest']);
  });

  it('with AVARICE_DEBUG_TRANSCRIPTS=1 stores the redacted transcript too, under the same digest', async () => {
    const s = setup({ transcript: 'success', mapFiles: 'all', extraLines: [tokenLine] });
    const run = await inProcess(s, { [DEBUG]: '1' });
    assert.equal(run.state, 'active');
    assert.deepEqual(kindsOf(s.roots), ['transcript', 'transcript-summary']);
    const step = launchResult(s.roots);
    assert.equal(step['transcript'], step['transcriptDigest'], 'the stored transcript is the one the digest covers');
    const stored = blob(s.roots, step['transcript'] as string);
    assert.ok(stored.includes('[REDACTED:github-token]'));
    assert.equal(longestTokenFragment(stored), 0);
    assert.equal(`sha256:${sha256Hex(stored)}`, step['transcriptDigest']);
  });
});

// The profile's own opt-in and refusal (D-14): the production composition reads the retention section of the profile config.
function writeProfileConfig(roots: CliRoots, config: Record<string, unknown>): void {
  const path = configPathFor(roots.AVARICE_CONFIG_HOME, 'personal-local');
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify({ schema: 1, ...config }, null, 2)}\n`, { mode: 0o600 });
}

describe('profile retention (D-14)', () => {
  it('stores the whole redacted transcript when the profile sets retention.transcripts to full, with no debug variable', () => {
    const s = setup({ transcript: 'success', mapFiles: 'all', extraLines: [tokenLine] });
    writeProfileConfig(s.roots, { retention: { transcripts: 'full' } });
    const ran = runCli(['onboard', '--policy', 'onboarding', s.repo.path], {
      roots: s.roots,
      entry: PRODUCTION_ENTRY,
      env: { AVARICE_CLAUDE_BIN: s.fake.bin, CLAUDE_CONFIG_DIR: s.configDir, AVARICE_GRAPHIFY_BIN: '/nonexistent', [DEBUG]: undefined },
      timeoutMs: 180_000,
    });
    assert.equal(ran.code, 0, ran.stdout + ran.stderr);
    assert.deepEqual(kindsOf(s.roots), ['transcript', 'transcript-summary']);
    const step = launchResult(s.roots);
    assert.equal(step['transcript'], step['transcriptDigest']);
    const stored = blob(s.roots, step['transcript'] as string);
    assert.ok(stored.includes('[REDACTED:github-token]'), 'the stored transcript is redacted');
    assert.equal(longestTokenFragment(stored), 0);
  });

  it('keeps the summary default when the profile has no retention section', () => {
    const s = setup({ transcript: 'success', mapFiles: 'all' });
    writeProfileConfig(s.roots, {});
    const ran = runCli(['onboard', '--policy', 'onboarding', s.repo.path], {
      roots: s.roots,
      entry: PRODUCTION_ENTRY,
      env: { AVARICE_CLAUDE_BIN: s.fake.bin, CLAUDE_CONFIG_DIR: s.configDir, AVARICE_GRAPHIFY_BIN: '/nonexistent', [DEBUG]: undefined },
      timeoutMs: 180_000,
    });
    assert.equal(ran.code, 0, ran.stdout + ran.stderr);
    assert.deepEqual(kindsOf(s.roots), ['transcript-summary']);
  });

  it('refuses a retention.transcripts value that is not summary or full, naming the key, before a store is opened', () => {
    const s = setup({ transcript: 'success' });
    writeProfileConfig(s.roots, { retention: { transcripts: 'all' } });
    const composed = createDeps(envFor(s));
    assert.equal(composed.ok, false);
    assert.ok(!composed.ok && /retention\.transcripts/.test(composed.message), `the refusal names the key: ${composed.ok ? '' : composed.message}`);
  });

  it('parses the retention section: absent and empty give summary, summary and full are read, anything else is refused by key', () => {
    assert.deepEqual(parseRetentionSection(undefined), { ok: true, value: { transcripts: 'summary' } });
    assert.deepEqual(parseRetentionSection({}), { ok: true, value: { transcripts: 'summary' } });
    assert.deepEqual(parseRetentionSection({ transcripts: 'full', other: 1 }), { ok: true, value: { transcripts: 'full' } });
    assert.deepEqual(parseRetentionSection({ transcripts: 'summary' }), { ok: true, value: { transcripts: 'summary' } });
    for (const bad of [{ transcripts: 'all' }, { transcripts: true }, { transcripts: null }]) {
      const parsed = parseRetentionSection(bad);
      assert.ok(!parsed.ok && parsed.error.kind === 'invalid' && parsed.error.field === 'retention.transcripts', JSON.stringify(bad));
    }
    for (const bad of ['full', 3, null, ['full']]) {
      const parsed = parseRetentionSection(bad);
      assert.ok(!parsed.ok && parsed.error.kind === 'invalid' && parsed.error.field === 'retention', JSON.stringify(bad));
    }
  });
});
