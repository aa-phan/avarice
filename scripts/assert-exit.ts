// Asserts the Phase 1 exit record (success criterion 1; plan 01-19) for one onboarding, from the ledger, read-only:
//
//   node scripts/assert-exit.ts [--db path/to/state.db] <onboardingId>
//
// The onboarding is `active`; its project has an active record with promotion `none` whose graph lists code nodes and
// document nodes (and a knowledge section that counts document nodes), and whose `indexes.graph.builtAtCommit` and
// `indexes.intel.refreshedAtCommit` both equal the onboarded revision. Revisions are compared without the `git:` prefix.
//
// Prints the JSON facts on stdout (`ok` says whether every check held). Exit 0 when every check holds, 1 when one fails
// (each failure is a line on stderr), 2 for a usage error, an unknown onboarding or an unreadable ledger.
// Without --db the ledger is `$AVARICE_DATA_ROOT/state.db`, else `~/.local/share/avarice/personal-local/state.db`;
// nothing is created.
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDb } from '../src/adapters/sqlite/db.ts';
import type { Db } from '../src/adapters/sqlite/db.ts';

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const strip = (revision: unknown): string | null => (typeof revision === 'string' && revision !== '' ? revision.replace(/^git:/, '') : null);
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

export interface ExitFacts {
  onboardingId: string;
  projectId: string;
  repoPath: string;
  state: string;
  recordVersion: number | null;
  promotion: string | null;
  onboardedRevision: string | null;
  mapping: unknown;
  nodes: Record<string, number> | null;
  edges: Record<string, number> | null;
  documentNodes: number | null;
  graphBuiltAtCommit: string | null;
  intelRefreshedAtCommit: string | null;
  intelFiles: number | null;
  absentIndexes: unknown;
}

// The facts of one onboarding, or null when the ID is unknown.
export function readExitFacts(db: Db, onboardingId: string): ExitFacts | null {
  const onboarding = db.prepare('SELECT onboarding_id, project_id, state FROM onboardings WHERE onboarding_id = ?').get(onboardingId) as { project_id: string; state: string } | undefined;
  if (onboarding === undefined) return null;
  const project = db.prepare('SELECT repo_path FROM projects WHERE project_id = ?').get(onboarding.project_id) as { repo_path: string } | undefined;
  const record = db
    .prepare("SELECT version, body_json, onboarded_revision FROM project_records WHERE project_id = ? AND state = 'active' AND superseded_at IS NULL ORDER BY version DESC LIMIT 1")
    .get(onboarding.project_id) as { version: number; body_json: string; onboarded_revision: string } | undefined;
  const facts: ExitFacts = {
    onboardingId,
    projectId: onboarding.project_id,
    repoPath: project?.repo_path ?? '',
    state: onboarding.state,
    recordVersion: null,
    promotion: null,
    onboardedRevision: null,
    mapping: null,
    nodes: null,
    edges: null,
    documentNodes: null,
    graphBuiltAtCommit: null,
    intelRefreshedAtCommit: null,
    intelFiles: null,
    absentIndexes: null,
  };
  if (record === undefined) return facts;
  const body = JSON.parse(record.body_json) as Json;
  const indexes = isObject(body['indexes']) ? body['indexes'] : {};
  const graph = isObject(indexes['graph']) ? indexes['graph'] : null;
  const intel = isObject(indexes['intel']) ? indexes['intel'] : null;
  const tally = (value: unknown): Record<string, number> | null =>
    isObject(value) ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, count(v)])) : null;
  facts.recordVersion = record.version;
  facts.promotion = typeof body['promotion'] === 'string' ? body['promotion'] : null;
  facts.onboardedRevision = strip(record.onboarded_revision);
  facts.mapping = body['mapping'] ?? null;
  facts.absentIndexes = indexes['absent'] ?? null;
  if (graph !== null) {
    facts.nodes = tally(graph['nodes']);
    facts.edges = tally(graph['edges']);
    facts.graphBuiltAtCommit = strip(graph['builtAtCommit']);
    const knowledge = isObject(graph['knowledge']) ? graph['knowledge'] : null;
    facts.documentNodes = knowledge === null ? null : count(knowledge['documentNodes']);
  }
  if (intel !== null) {
    facts.intelRefreshedAtCommit = strip(intel['refreshedAtCommit']);
    facts.intelFiles = typeof intel['files'] === 'number' ? intel['files'] : null;
  }
  return facts;
}

// Every check that fails, as a sentence.
export function judgeExit(f: ExitFacts): string[] {
  const problems: string[] = [];
  if (f.state !== 'active') problems.push(`the onboarding state is ${f.state}, not active`);
  if (f.recordVersion === null) {
    problems.push(`no active project record for project ${f.projectId}`);
    return problems;
  }
  if (f.promotion !== 'none') problems.push(`promotion is ${String(f.promotion)}, not none`);
  if (f.nodes === null) {
    problems.push('the record has no graph index');
  } else {
    if (count(f.nodes['code']) <= 0) problems.push('the graph lists no code nodes');
    if (count(f.nodes['document']) <= 0 || f.documentNodes === null || f.documentNodes <= 0) {
      problems.push(`the graph lists no document nodes (nodes.document ${count(f.nodes['document'])}, knowledge.documentNodes ${f.documentNodes === null ? 'absent' : f.documentNodes})`);
    }
    if (f.graphBuiltAtCommit !== f.onboardedRevision) {
      problems.push(`graph builtAtCommit ${String(f.graphBuiltAtCommit)} is not the onboarded revision ${String(f.onboardedRevision)}`);
    }
  }
  if (f.intelRefreshedAtCommit === null && f.intelFiles === null) {
    problems.push('the record has no intel index');
  } else if (f.intelRefreshedAtCommit !== f.onboardedRevision) {
    problems.push(`intel refreshedAtCommit ${String(f.intelRefreshedAtCommit)} is not the onboarded revision ${String(f.onboardedRevision)}`);
  }
  return problems;
}

export function defaultLedgerPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env['HOME'] !== undefined && env['HOME'] !== '' ? env['HOME'] : homedir();
  const dataRoot = env['AVARICE_DATA_ROOT'] !== undefined && env['AVARICE_DATA_ROOT'] !== '' ? resolve(env['AVARICE_DATA_ROOT']) : join(home, '.local', 'share', 'avarice', 'personal-local');
  return join(dataRoot, 'state.db');
}

function main(argv: readonly string[]): number {
  let dbPath: string | undefined;
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i] as string;
    if (word === '--db') dbPath = argv[++i];
    else if (word.startsWith('--db=')) dbPath = word.slice('--db='.length);
    else if (word.startsWith('--')) {
      process.stderr.write(`assert-exit: unknown option ${word}\n`);
      return 2;
    } else positionals.push(word);
  }
  const [onboardingId] = positionals;
  if (onboardingId === undefined || positionals.length !== 1 || dbPath === '') {
    process.stderr.write('usage: node scripts/assert-exit.ts [--db path/to/state.db] <onboardingId>\n');
    return 2;
  }
  const opened = openDb(dbPath ?? defaultLedgerPath(), { readOnly: true });
  if (!opened.ok) {
    process.stderr.write(`assert-exit: cannot open the ledger read-only: ${opened.error.kind}\n`);
    return 2;
  }
  try {
    const facts = readExitFacts(opened.value, onboardingId);
    if (facts === null) {
      process.stderr.write(`assert-exit: no onboarding ${onboardingId} in the ledger\n`);
      return 2;
    }
    const problems = judgeExit(facts);
    process.stdout.write(`${JSON.stringify({ ok: problems.length === 0, ...facts, problems }, null, 2)}\n`);
    for (const problem of problems) process.stderr.write(`assert-exit: FAILED: ${problem}\n`);
    return problems.length === 0 ? 0 : 1;
  } catch (e) {
    process.stderr.write(`assert-exit: ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  } finally {
    opened.value.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main(process.argv.slice(2));
