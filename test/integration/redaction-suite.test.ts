// AC-5, the redaction suite (plan 04-22; SEC-3, T-04-60, T-04-61): a secret corpus (one sample of every pattern kind and a seeded credential value) is
// injected through every input of a profile, and a full dump of the store, every artifact file and the shell history hold none of it.
//
// The inputs, each with a positive control (the raw input holds the corpus before anything is stored):
//   - the brief of a run (its title and behavior text, which the contract and the events carry);
//   - repository files (a source file, a text file and the output of a declared check that prints the text file);
//   - the output of a declared check;
//   - the host transcript (assistant text and tool-result lines of a fake claude, with the whole transcript stored through AVARICE_DEBUG_TRANSCRIPTS);
//   - hook event targets (shell lines the fake run host's unit tries through the real PreToolUse hook entry);
//   - the interactive shell's command line (history).
// The seeded value is resolved from a temporary keychain, which seeds the redactor of this process, as a run would. A fake claude and a fake run host stand in
// for the model; the store, ledger, artifact store, redactor, hook entry, supervisor and shell are the production ones.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { KeychainProvider } from '../../src/adapters/credential/keychain.ts';
import { fingerprintGsdPreamble } from '../../src/adapters/gsd/preamble.ts';
import { locateGsdCore } from '../../src/adapters/gsd/locate.ts';
import { ClaudeHostAdapter } from '../../src/adapters/host-claude/claude-host.ts';
import { processRedactor } from '../../src/adapters/redaction/process-redactor.ts';
import { runOnboarding, startOnboarding } from '../../src/app/onboarding-service.ts';
import { resolveCredential } from '../../src/app/credentials.ts';
import { runSupervisor } from '../../src/app/run-service.ts';
import { startRun } from '../../src/app/run-start.ts';
import type { AppDeps } from '../../src/app/deps.ts';
import { HISTORY_FILE } from '../../src/cli/shell/history.ts';
import { runShell } from '../../src/cli/shell/shell.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { findSecrets, redactSecrets } from '../../src/domain/secret-patterns.ts';
import { makeFakeClaude } from '../helpers/fake-claude.ts';
import type { FakeClaude } from '../helpers/fake-claude.ts';
import { FakeRunHost } from '../helpers/fake-run-host.ts';
import { REPO_ROOT, makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { SECRET_CORPUS, SEEDED_VALUE, scanForCorpus, scanTotal } from '../helpers/secret-corpus.ts';
import { FIXED_SLUG, RUN_BRIEF, RUN_CONVENTIONS, RUN_REPO_FILES, commitConventions, profileEnv, writeBrief } from '../helpers/run-fixtures.ts';
import { fakeTerminal } from '../helpers/shell-streams.ts';
import { makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const CLEANUP: string[] = [];
const KEYCHAINS: string[] = [];
after(() => {
  for (const path of KEYCHAINS) spawnSync('/usr/bin/security', ['delete-keychain', path], { encoding: 'utf8' });
  for (const dir of CLEANUP) rmSync(dir, { recursive: true, force: true });
});

const HOOK_ENTRY = join(REPO_ROOT, 'src', 'hook', 'pre-tool-use.ts');
const KEYCHAIN_PASSWORD = 'avarice-test-keychain-password';
const SERVICE = 'avarice-redaction-suite';
const KINDS = SECRET_CORPUS.map((e) => e.kind);
const allCorpus = (): string => SECRET_CORPUS.map((e) => e.text).join('\n');

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  CLEANUP.push(dir);
  return dir;
}

function security(args: readonly string[]): void {
  const ran = spawnSync('/usr/bin/security', [...args], { encoding: 'utf8' });
  assert.equal(ran.status, 0, `security ${args[0]}: ${ran.stderr}`);
}

// A keychain file of its own holding the seeded value; never added to the search list and deleted in `after`.
function makeKeychain(dir: string): string {
  const path = join(dir, 'avarice-redaction.keychain-db');
  KEYCHAINS.push(path);
  security(['create-keychain', '-p', KEYCHAIN_PASSWORD, path]);
  security(['unlock-keychain', '-p', KEYCHAIN_PASSWORD, path]);
  security(['add-generic-password', '-s', SERVICE, '-a', 'avarice-test', '-w', SEEDED_VALUE, path]);
  return path;
}

// ---- what is injected --------------------------------------------------------------------------------------------------------------------------------

// A comment per corpus sample, as a source file would carry it (the private key block line by line).
const SOURCE_WITH_SECRETS = `${[...SECRET_CORPUS.map((e) => e.text), SEEDED_VALUE].flatMap((t) => t.split('\n')).map((line) => `// ${line}`).join('\n')}\nexport const configured = true;\n`;
const SECRETS_TEXT = `${[...SECRET_CORPUS.map((e) => e.text), `seeded value ${SEEDED_VALUE}`].join('\n')}\n`;
const PRINT_SECRETS = "import { readFileSync } from 'node:fs';\nprocess.stdout.write(readFileSync('fixtures/secrets.txt', 'utf8'));\n";

const BRIEF = RUN_BRIEF.replace('title: Collapse repeated dashes in slugs', `title: Collapse dashes ${SECRET_CORPUS[0]?.text ?? ''}`)
  .replace('A slug never contains two dashes in a row.', `A slug never contains two dashes in a row.\n${[...SECRET_CORPUS.map((e) => e.text), `credential ${SEEDED_VALUE}`].join('\n')}`)
  .replace('## Target checks\n- test\n', '## Target checks\n- test\n- print-secrets\n');

// The lines of the transcript the fake claude prints: an assistant text line and a tool result, each carrying the corpus.
const TRANSCRIPT_LINES: readonly string[] = [
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: `found these: ${allCorpus()} and ${SEEDED_VALUE}` }] } }),
  JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_01', content: `${allCorpus()}\ncredential ${SEEDED_VALUE}` }] } }),
];

// The corpus samples that fit on one line (a private key block does not).
const ONE_LINE = SECRET_CORPUS.filter((e) => !e.text.includes('\n')).map((e) => e.text);

// Files the unit writes under names that carry a secret. The hook records the staging-relative target of every write it admits (and the path of every file it saw
// read, for the read-before-edit rule), and a name is the one place a secret can reach what it writes: it holds no space or slash, so the kinds that need them (an
// Authorization header, a URL) cannot be named. The seeded value is not injected here: the hook is a process of its own that never resolves a credential, so it
// cannot know a seeded literal (recorded as an owner decision in the summary of plan 04-22).
const NAMED_BY: ReadonlyArray<{ kind: string; text: string }> = SECRET_CORPUS.filter((e) => !/[ /:@\n]/.test(e.text));
const TARGET_EDITS: Readonly<Record<string, string>> = Object.fromEntries(NAMED_BY.map((n) => [`src/${n.text}.ts`, 'export const named = true;\n']));

// Lines typed into the shell's command line.
const TYPED_LINES: readonly string[] = [...ONE_LINE.map((text) => `status ${text}`), `status ${SEEDED_VALUE}`];

// ---- what is searched --------------------------------------------------------------------------------------------------------------------------------

function treeFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(full);
    }
  };
  if (lstatSync(root).isDirectory()) walk(root);
  return out;
}

// The string leaves of a JSON text (the text itself when it is not JSON), so a secret a JSON escape hid from a line scan is read back as it would be used.
function leaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(leaves);
  return [];
}

// One text per table of the store: every column of every row as it is stored (a blob as latin1), and for a text column that holds JSON also its decoded strings.
function dumpStore(dataRoot: string): Array<{ table: string; text: string }> {
  const db = new DatabaseSync(join(dataRoot, 'state.db'), { readOnly: true, timeout: 5000 });
  try {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map((t) => t.name);
    return tables.map((table) => {
      const cells: string[] = [];
      for (const row of db.prepare(`SELECT * FROM "${table}"`).all() as Array<Record<string, unknown>>) {
        for (const value of Object.values(row)) {
          if (typeof value === 'string') {
            cells.push(value);
            try {
              cells.push(...leaves(JSON.parse(value)));
            } catch {
              // not JSON
            }
          } else if (value instanceof Uint8Array) cells.push(Buffer.from(value).toString('latin1'));
          else if (value !== null && value !== undefined) cells.push(String(value));
        }
      }
      return { table, text: cells.join('\n') };
    });
  } finally {
    db.close();
  }
}

interface Boundary {
  name: string;
  text: string;
}

function boundaries(roots: CliRoots): Boundary[] {
  const data = roots.AVARICE_DATA_ROOT;
  const out: Boundary[] = dumpStore(data).map((t) => ({ name: `SQLite table ${t.table}`, text: t.text }));
  for (const file of treeFiles(join(data, 'artifacts'))) out.push({ name: `artifact ${file.slice(data.length + 1)}`, text: readFileSync(file, 'latin1') });
  const history = join(data, HISTORY_FILE);
  out.push({ name: 'shell history', text: existsSync(history) ? readFileSync(history, 'utf8') : '' });
  // Every other file of the data root too: the database and its write-ahead log byte for byte, and what the stages wrote beside them.
  for (const file of treeFiles(data)) {
    if (file.startsWith(join(data, 'artifacts')) || file === history) continue;
    out.push({ name: `file ${file.slice(data.length + 1)}`, text: readFileSync(file, 'latin1') });
  }
  return out;
}

// ---- the profile -------------------------------------------------------------------------------------------------------------------------------------

interface World {
  roots: CliRoots;
  repo: ScratchRepo;
  fake: FakeClaude;
  configDir: string;
  keychain: string;
  env: NodeJS.ProcessEnv;
  runState: string;
  seededBefore: boolean;
}

const world: Partial<World> = {};

function build(): World {
  const roots = makeRoots();
  const base = tempDir('avarice-redaction-');
  const repo = makeScratchRepo({
    files: { ...RUN_REPO_FILES, 'src/secrets.ts': SOURCE_WITH_SECRETS, 'fixtures/secrets.txt': SECRETS_TEXT, 'scripts/print-secrets.mjs': PRINT_SECRETS },
  });
  const fake = makeFakeClaude({ transcript: 'success', mapFiles: 'all', extraLines: TRANSCRIPT_LINES });
  const configDir = join(base, 'claude-config');
  for (const skill of ['gsd-map-codebase', 'graphify']) {
    mkdirSync(join(configDir, 'skills', skill), { recursive: true });
    writeFileSync(join(configDir, 'skills', skill, 'SKILL.md'), `---\nname: ${skill}\ndescription: stand-in\n---\n`);
  }
  CLEANUP.push(roots.base, repo.base, fake.dir);
  const env: NodeJS.ProcessEnv = { ...profileEnv(roots), AVARICE_CLAUDE_BIN: fake.bin, CLAUDE_CONFIG_DIR: configDir, AVARICE_GRAPHIFY_BIN: '/nonexistent', AVARICE_DEBUG_TRANSCRIPTS: '1' };
  return { roots, repo, fake, configDir, keychain: makeKeychain(base), env, runState: '', seededBefore: false };
}

// The credential of the keychain is resolved, which seeds the redactor of this process before anything below is stored.
async function seedFromKeychain(w: World): Promise<void> {
  const composed = createDeps(w.env);
  assert.ok(composed.ok, 'composition');
  try {
    const { deps } = composed.value;
    const resolved = await resolveCredential({ ledger: deps.ledger, clock: deps.clock, profile: deps.profile, providers: { keychain: new KeychainProvider({ keychainPath: w.keychain }) } }, `keychain:${SERVICE}`, 'redaction suite', { module: 'redaction-suite' });
    assert.ok(resolved.ok, JSON.stringify(resolved));
    await resolved.value.use((value) => {
      assert.equal(value, SEEDED_VALUE, 'the keychain handed back the seeded value');
    });
  } finally {
    composed.value.close();
  }
}

// Onboarding through the production adapter for the host (the fake claude replays the transcript carrying the corpus; the whole transcript is stored).
async function onboardThroughClaudeHost(w: World): Promise<string> {
  const composed = createDeps(w.env);
  assert.ok(composed.ok, 'composition');
  const located = locateGsdCore(w.env);
  assert.ok(located.ok, 'gsd-core is installed');
  const preamble = fingerprintGsdPreamble(located.value.gsdCoreDir);
  assert.ok(preamble.ok, 'the GSD preamble is found');
  const { deps } = composed.value;
  try {
    const adapter = new ClaudeHostAdapter({
      claudeBin: w.fake.bin,
      hookEntry: HOOK_ENTRY,
      ledgerPath: join(deps.profile.dataRoot, 'state.db'),
      dataRoot: deps.profile.dataRoot,
      gsd: { gsdCoreDir: located.value.gsdCoreDir, agentsDir: join(located.value.gsdCoreDir, '..', 'agents'), skillsRoot: join(w.configDir, 'skills'), preamble: preamble.value },
      artifacts: deps.artifacts,
      staging: deps.staging,
      countHookDenies: (id) => deps.ledger.countHookDenials(id),
      env: w.env,
    });
    const wired: AppDeps = { ...deps, host: adapter };
    const started = startOnboarding(wired, { repoPath: w.repo.path, policy: 'onboarding', mode: 'full' });
    assert.ok(started.ok, 'registration');
    const outcome = await runOnboarding(wired, started.value.onboardingId);
    assert.ok(outcome.ok, 'the onboarding ran');
    return outcome.value.state;
  } finally {
    composed.value.close();
  }
}

// A run with the fake run host: the brief carries the corpus, a declared check prints it, the unit tries shell lines that name it through the real hook.
async function runWithCorpus(w: World): Promise<string> {
  commitConventions(w.repo, {
    ...RUN_CONVENTIONS,
    checks: [...RUN_CONVENTIONS.checks, { name: 'print-secrets', argv: ['node', 'scripts/print-secrets.mjs'], timeoutSec: 60, required: false }],
    agentCommands: ['npm test'],
  });
  const brief = writeBrief(join(w.roots.base, 'briefs'), BRIEF);
  const host = new FakeRunHost({ edits: { 'src/slug.ts': FIXED_SLUG, ...TARGET_EDITS }, summary: true, verification: 'passed' });
  const composed = createDeps(w.env, { host });
  assert.ok(composed.ok, 'composition');
  try {
    const started = startRun(composed.value.deps, { cwd: w.repo.path, briefPath: brief, policy: 'routine', budgetOverrides: {} });
    assert.ok(started.ok, JSON.stringify(started));
    const outcome = await runSupervisor(composed.value.deps, started.value.runId);
    assert.ok(outcome.ok, JSON.stringify(outcome));
    return `${outcome.value.state}${outcome.value.reason !== null ? ` (${outcome.value.reason})` : ''}`;
  } finally {
    composed.value.close();
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(condition: () => boolean, what: string): Promise<void> {
  for (let waited = 0; waited < 20_000; waited += 25) {
    if (condition()) return;
    await sleep(25);
  }
  assert.fail(`timed out waiting for ${what}`);
}

// The shell's command line, typed one line at a time through the line editor; the dispatcher accepts every line.
async function typeIntoShell(w: World): Promise<void> {
  const term = fakeTerminal();
  const calls: string[][] = [];
  const exited = runShell({
    stdin: term.stdin,
    stdout: term.stdout,
    // A terminal the shell takes raw key presses from, outside a run, in colour or not.
    env: { ...w.env, TERM: 'xterm-256color', NO_COLOR: undefined, AVARICE_RUN: undefined },
    dispatch: (argv) => {
      calls.push([...argv]);
      return Promise.resolve(0);
    },
  });
  await waitFor(() => term.output().includes('open decisions:'), 'the shell home view');
  for (const line of TYPED_LINES) {
    const before = calls.length;
    term.type(':');
    term.type(`${line}\r`);
    await waitFor(() => calls.length > before, `the command ${line.slice(0, 12)}...`);
    // The shell redraws its home view after a command; wait for it so the next keystrokes reach the menu.
    await sleep(100);
  }
  term.type('q');
  assert.equal(await exited, 0);
  assert.equal(calls.length, TYPED_LINES.length, 'the dispatcher ran every typed line');
}

describe('AC-5: a secret corpus injected through every input leaves none of it in the store, the artifacts or the history', () => {
  before(async () => {
    const w = build();
    Object.assign(world, w);
    const preSeed = processRedactor.redact(`x ${SEEDED_VALUE} y`);
    w.seededBefore = preSeed.includes(SEEDED_VALUE);
    await seedFromKeychain(w);
    const onboarded = await onboardThroughClaudeHost(w);
    assert.equal(onboarded, 'active');
    w.runState = await runWithCorpus(w);
    await typeIntoShell(w);
    world.runState = w.runState;
    world.seededBefore = w.seededBefore;
  });

  const w = (): World => world as World;

  it('control: every corpus sample triggers its own pattern, and the seeded value triggers none (only the seeded literal can redact it)', () => {
    for (const entry of SECRET_CORPUS) assert.ok(findSecrets(entry.text).some((h) => h.pattern === entry.kind), `the ${entry.kind} sample matches ${entry.kind}`);
    assert.deepEqual(findSecrets(SEEDED_VALUE), []);
    assert.equal(w().seededBefore, true, 'before the keychain was resolved the process redactor did not know the value');
    assert.equal(processRedactor.redact(`x ${SEEDED_VALUE} y`).includes(SEEDED_VALUE), false, 'after it, the redactor does');
  });

  it('control: each input holds every corpus kind before anything is stored', () => {
    const inputs: Array<[string, string]> = [
      ['brief', BRIEF],
      ['repository source file', SOURCE_WITH_SECRETS],
      ['repository text file printed by the declared check', readFileSync(join(w().repo.path, 'fixtures', 'secrets.txt'), 'utf8')],
      ['host transcript', TRANSCRIPT_LINES.flatMap((line) => leaves(JSON.parse(line))).join('\n')],
      ['hook event targets (file names)', Object.keys(TARGET_EDITS).join('\n')],
      ['shell command lines', TYPED_LINES.join('\n')],
    ];
    for (const [name, text] of inputs) {
      const found = new Set(findSecrets(text).map((h) => h.pattern));
      // A shell line carries no line break, so no private key block; a file name carries none of a block, a header, a URL or a space either.
      const expected = name.startsWith('hook') ? NAMED_BY.map((n) => n.kind) : name.startsWith('shell') ? KINDS.filter((k) => k !== 'private-key') : KINDS;
      for (const kind of expected) assert.ok(found.has(kind), `the ${name} holds a ${kind} sample`);
      if (!name.startsWith('hook')) assert.ok(text.includes(SEEDED_VALUE), `the ${name} holds the seeded value`);
    }
    assert.ok(scanTotal(scanForCorpus(allCorpus())) >= KINDS.length, 'the scan finds the raw corpus');
    assert.equal(scanForCorpus(`only ${SEEDED_VALUE}`).seeded, 1, 'and the seeded value alone');
  });

  it('the onboarding through the production host adapter ended active, the whole transcript was stored, and the run reached ready_for_review', () => {
    const db = new DatabaseSync(join(w().roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
    try {
      const kinds = new Set((db.prepare('SELECT kind FROM artifacts').all() as Array<{ kind: string }>).map((r) => r.kind));
      for (const kind of ['transcript', 'transcript-summary', 'check-output']) assert.ok(kinds.has(kind), `an artifact of kind ${kind} was stored`);
      const hook = db.prepare("SELECT count(*) AS n FROM events WHERE type LIKE 'hook.%' OR type LIKE 'tool.%'").get() as { n: number };
      assert.ok(hook.n > 0, 'the hook wrote events');
      assert.equal((db.prepare("SELECT count(*) AS n FROM events WHERE type = 'credential.resolve'").get() as { n: number }).n, 1);
    } finally {
      db.close();
    }
    assert.equal(w().runState, 'ready_for_review');
    assert.ok(existsSync(join(w().roots.AVARICE_DATA_ROOT, HISTORY_FILE)), 'the shell wrote its history');
  });

  it('secret patterns found: 0 (no findSecrets hit and no seeded value in the SQLite dump, any artifact file or the history file)', () => {
    const found: string[] = [];
    let scanned = 0;
    for (const boundary of boundaries(w().roots)) {
      scanned += 1;
      const scan = scanForCorpus(boundary.text);
      if (scanTotal(scan) > 0) found.push(`${boundary.name}: ${JSON.stringify({ patterns: scan.patterns.map((h) => `${h.pattern}@${h.line}`), seeded: scan.seeded, literals: scan.literals })}`);
    }
    console.log(`secret patterns found: ${found.length} (${scanned} stores scanned: the SQLite dump, the artifact files, the history file and the rest of the data root)`);
    assert.deepEqual(found, []);
  });

  // Positive control per input: the marker of what was injected is in the store that input reaches, so a pass is not a pass on an empty store.
  it('each input left its redaction markers in the store it reaches (the 0 above is not a pass on empty stores)', () => {
    const all = boundaries(w().roots);
    const marked = (what: string, match: (name: string) => boolean, kinds: readonly string[]): void => {
      const text = all.filter((b) => match(b.name)).map((b) => b.text).join('\n');
      for (const kind of kinds) assert.ok(text.includes(`[REDACTED:${kind}]`), `${what}: [REDACTED:${kind}] is in the store`);
    };
    const oneLine = KINDS.filter((k) => k !== 'gsd-scan');
    const named = NAMED_BY.filter((x) => x.kind !== 'gsd-scan').map((x) => x.kind);
    marked('the brief, in the contract', (n) => n === 'SQLite table contracts', [...oneLine, 'seeded']);
    marked('the brief, in the run title', (n) => n === 'SQLite table runs', ['github-token']);
    marked('a file name, in the events the hook wrote', (n) => n === 'SQLite table events', named);
    marked('a file name, in the reads the hook recorded', (n) => n === 'SQLite table hook_reads', named);
    // An AWS key ID and an `sk-` key are named by the GSD pattern when a JSON escape sits before them (the AVARICE aws-key pattern wants a word boundary), so the
    // transcript carries [REDACTED:gsd-scan] for them and the check output [REDACTED:aws-key].
    marked('the transcript and the check output, in the artifacts', (n) => n.startsWith('artifact '), ['github-token', 'jwt', 'private-key', 'authorization', 'url-userinfo', 'gsd-scan', 'aws-key', 'seeded']);
    marked('the typed command lines, in the history', (n) => n === 'shell history', [...oneLine.filter((k) => k !== 'private-key'), 'seeded']);
    assert.equal(redactSecrets(allCorpus()).includes(SECRET_CORPUS[0]?.text ?? ''), false);
  });
});
