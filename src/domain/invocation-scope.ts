// Vendor-neutral write, read and command scope of one contained invocation (ONB-3, ONB-4, CON-2, CON-5).
// Pure: every path arrives as a string, the host adapter turns the scope into its own settings, and the hook
// (plan 01-12) turns the same scope into its policy. Nothing here knows Claude Code.
//
// Why denyWrite lists every existing out-of-scope entry (spike S0-B, docs/containment.md): the working
// directory is always writable to a sandboxed shell, and a denyWrite on a path overrides an allowWrite beneath
// it, so the only way to keep a shell out of `src/` is to deny each existing entry one by one. Entries created
// later at unlisted locations are caught by the staging diff gate, not prevented.
import { isRefusedAgentCommand } from './conventions.ts';
import { matchesAny } from './glob.ts';
import { normalizedAbsoluteRoot, trimTrailingSlashes } from './normalized-root.ts';
import type { OnboardingContract } from './onboarding-contract.ts';
import { ROUTINE_PRESET } from './run-contract.ts';
import type { RunContract } from './run-contract.ts';

export type InvocationPurpose = 'map' | 'intel' | 'knowledge' | 'run';

// How Bash commands are admitted under dontAsk (spike S0-A, 01-RESEARCH "Bash allow-list under dontAsk").
//   blanket-bash-hook-identity  `Bash` is allowed; the AVARICE PreToolUse hook admits only commands matching the
//                               identity rules (GSD preamble fingerprint then a read verb, the read-only command
//                               set), and the sandbox confines the effects of anything that slips through
//   narrow-rules                `Bash(cmd:*)` allow rules only
//   hook-allow                  no Bash allow rule; the hook returns allow for identity-matching commands
//   none                        no shell at all: no Bash allow rule, Bash denied, and the hook denies every shell call
//                               (the knowledge purpose, decision B of 2026-11-03)
export type BashStrategy = 'blanket-bash-hook-identity' | 'narrow-rules' | 'hook-allow' | 'none';

// Owner decision of plan 01-11 Task 1 (checkpoint:decision, resolved 2026-11-02): blanket Bash with the hook as
// the command-identity control. S0-A showed that skills pre-approve Bash, that the GSD preamble is a 2.5 KB
// compound line, and that a hook deny holds even against the skill grant.
export const ONBOARDING_BASH_STRATEGY = 'blanket-bash-hook-identity' as BashStrategy;

export interface PurposeSpec {
  // Repository-relative directory the agent may write; AVARICE pre-creates it.
  writeDir: string;
  // `staging`: the invocation runs in the staging root (GSD hard-codes <cwd>/.planning).
  // `read-dir`: it runs in `readDir`, the one directory it may read (the knowledge pass: its corpus).
  cwd: 'staging' | 'read-dir';
  // The repository-relative directory a `read-dir` purpose may read, and nothing else; the write directory lies inside it.
  readDir?: string;
}

// The knowledge purpose (plan 01-19 decision B) reads the corpus `.avarice-knowledge` with Read, Glob and Grep and writes one
// extraction JSON per chunk into `.avarice-knowledge/.extraction` with Write: no shell, no skill, no subagent.
//
// The run purpose (plan 02-08) has no single write directory: its writes come from the run contract's write, create and artifact
// globs and are computed by computeRunScope. `writeDir` is empty for that reason and no code reads it for a run.
export const INVOCATION_PURPOSES = {
  map: { writeDir: '.planning/codebase', cwd: 'staging' },
  intel: { writeDir: '.planning/intel', cwd: 'staging' },
  knowledge: { writeDir: '.avarice-knowledge/.extraction', cwd: 'read-dir', readDir: '.avarice-knowledge' },
  run: { writeDir: '', cwd: 'staging' },
} as const satisfies Record<InvocationPurpose, PurposeSpec>;

// What each contained invocation may load: the skills the generated plugin directory links and the agents the
// generated --agents file carries. map: the fast and full map skill and its mapper agent. intel: no skill, because
// `claude -p --agent gsd-intel-updater` runs the agent directly (S0-D). knowledge: nothing (decision B: no graphify skill; the
// model reads the chunked documents and writes extraction JSON itself).
export const PURPOSE_EXTENSIONS: Readonly<Record<InvocationPurpose, { skills: readonly string[]; agents: readonly string[] }>> = {
  map: { skills: ['gsd-map-codebase'], agents: ['gsd-codebase-mapper'] },
  intel: { skills: [], agents: ['gsd-intel-updater'] },
  knowledge: { skills: [], agents: [] },
  // The run purpose loads the GSD quick-task skill and the four agents `/gsd-quick --validate` starts (planner, plan checker,
  // executor, verifier); the generated agent files keep `permissionMode` stripped like every other purpose's.
  run: { skills: ['gsd-quick'], agents: ['gsd-planner', 'gsd-plan-checker', 'gsd-executor', 'gsd-verifier'] },
};

// Subagent types a purpose may start besides the agents it loads (PURPOSE_EXTENSIONS.agents are always allowed). Built-in
// types need no agent file. The graphify skill spawned one `general-purpose` subagent per chunk of documents (spike S0-G); the
// knowledge pass no longer loads it (decision B), so no purpose admits a type beyond its agents.
export const PURPOSE_SUBAGENT_TYPES: Readonly<Record<InvocationPurpose, readonly string[]>> = {
  map: [],
  intel: [],
  knowledge: [],
  run: [],
};

// Commands the hook admits without a GSD verb. `find` is admitted only without the actions in
// FIND_DENIED_ACTIONS; the other entries are admitted as written (the hook also refuses redirections, `git -c`
// and `git log --output`). The hook also judges the path of a git object name (`<rev>:<path>`), admits only listed options
// for `git log` and `git status`, and admits `git show` only with object-by-path operands and no option, so a secret file
// is not printed through history or the index. `grep` is not admitted (review WR-02): the Bash tool may run it as the embedded ugrep or the
// system grep, chosen per call, so the hook cannot model its options. Searches go through the Grep tool, whose root the
// hook judges.
export const READ_ONLY_COMMANDS: readonly string[] = [
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'find',
  'git ls-files',
  'git log',
  'git rev-parse',
  'git status',
  'git show',
];

// The Bash tool may run `find` as the embedded bfs, where `-rm` is an alias of `-delete`.
export const FIND_DENIED_ACTIONS: readonly string[] = [
  '-exec',
  '-execdir',
  '-ok',
  '-okdir',
  '-delete',
  '-rm',
  '-fprint',
  '-fprint0',
  '-fprintf',
  '-fls',
];

// GSD verbs a contained invocation may run after the GSD preamble. All are read-only inside the sandbox
// (01-RESEARCH "Verbs, outputs and side effects": confined-write run). Verbs that write are not here:
// `config-set`, `stamp-codebase-map` and `init onboard` run in AVARICE, outside any invocation, before launch.
const GSD_BASE_VERBS: readonly string[] = [
  'runtime-identity',
  'query init.map-codebase',
  'query agent-skills',
  'verify codebase-drift',
  'state json',
  'roadmap analyze',
  'graphify status',
  'graphify query',
  'intel status',
  'intel diff',
  'intel query',
];

// The intel-updater agent ends with these (it writes only under .planning/intel).
const GSD_INTEL_VERBS: readonly string[] = ['intel patch-meta', 'intel validate', 'intel snapshot'];

export const GSD_READ_VERBS: Readonly<Record<InvocationPurpose, readonly string[]>> = {
  map: GSD_BASE_VERBS,
  intel: [...GSD_BASE_VERBS, ...GSD_INTEL_VERBS],
  // The knowledge pass has no shell, so no GSD verb.
  knowledge: [],
  // The Phase 1 read verbs plus the ones the quick workflow runs, each with the GSD source line that runs it (plan 02-09, spike S2-B;
  // ~/.claude/gsd-core/workflows/quick.md, GSD 1.17.0). No verb that writes (`config-set`, `query commit`, `quick-tasks-append`) is here.
  //   - `query init.quick`: line 125, the workflow's first shell step (`--validate` is the only extra flag, GSD_VERB_FLAGS).
  //   - `query config-get <key>`: quick.md lines 43, 143, 144 and 698, and agents/gsd-executor.md lines 310-312; the key must be one of
  //     GSD_OPERAND_NAMES.
  //   - `loop render-hooks <point>`: lines 289 (plan:pre) and 560 (execute:post); read-only, the point is one of GSD_OPERAND_NAMES.
  run: [...GSD_BASE_VERBS, 'query init.quick', 'query config-get', 'loop render-hooks'],
};

// Never allowed, whatever else matches (deny rules beat allow rules).
export const DENIED_COMMAND_PREFIXES: readonly string[] = [
  'git push',
  'git commit',
  'git -c',
  'git config',
  'gh',
  'claude',
  'avarice',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'curl',
  'wget',
  'pip',
  'uv pip',
  'make',
];

// The parts of a WorkspaceDescription (src/ports/staging-workspace.ts) this module reads. Declared here so
// the domain does not import a port.
export interface WorkspaceShape {
  topLevelEntries: readonly string[];
  planningEntries: readonly string[];
  gitPaths: readonly string[];
  repoReadAllow: readonly string[];
}

// One shell command the run contract lists for the agent (RC-1 execution.commands), split into words. `paths: true` is an entry that
// ended in `<paths>`: further words are admitted when each is a relative path that passes the read rule.
export interface AgentCommand {
  words: string[];
  paths: boolean;
}

export interface InvocationScope {
  purpose: InvocationPurpose;
  cwd: string;
  stagingPath: string;
  repoPath: string;
  dataRoot: string;
  writeRoots: string[];
  // Run purpose only (plan 02-08): files the contract names literally (a file root, not a directory), the contract's write, create
  // and artifact globs and its protected globs (clone-relative, what the hook matches), the run's scratch directory (a write root
  // beside the clone: TMPDIR and the npm cache live there), the tools the hook refuses by name and whether a background shell is refused.
  writeFiles?: string[];
  writeGlobs?: string[];
  protectedGlobs?: string[];
  scratchDir?: string;
  deniedTools?: string[];
  denyBackgroundShell?: boolean;
  // Run purpose only (plan 02-11): the hook requires a recorded read of a file, by the same agent in this invocation, before an edit of it
  // (CON-7).
  readBeforeEdit?: boolean;
  // Run purpose only (plan 02-11): the contract's loop limits (CON-14), which the hook turns into a stop for escalation.
  escalation?: { consecutiveDenials: number; consecutiveSearches: number };
  denyWrite: string[];
  denyRead: string[];
  // Repository-relative globs (secret-bearing files) the agent must not read inside staging.
  denyReadGlobs: string[];
  allowRead: string[];
  // When present, reads are confined to these roots (the knowledge purpose: its corpus only).
  readConfine?: string[];
  readRoots: string[];
  commands: {
    strategy: BashStrategy;
    readOnly: string[];
    gsdReadVerbs: string[];
    deniedPrefixes: string[];
    agentCommands?: AgentCommand[];
    preambleSha256?: string;
  };
  subagents: { total: number; concurrent: number };
  allowedDomains: string[];
}

export interface ScopeInput {
  purpose: InvocationPurpose;
  contract: Pick<OnboardingContract, 'files' | 'budgets'>;
  stagingPath: string;
  repoPath: string;
  dataRoot: string;
  home: string;
  // The profile work root that holds every onboarding's staging (`{workRoot}/{onboardingId}/staging`); denied to the invocation so it
  // cannot read another onboarding (docs/containment.md:78), with its own staging re-allowed. Required, so the type makes every
  // caller pass it and no caller can drop the work-root deny without notice (WR-03). Also checked at run time (WR-01): an empty
  // root or '/' would deny every read, including the read roots, and a relative or non-normalized root would match no canonical
  // path, so the deny would not apply. Either one throws a TypeError that names the field. Trailing slashes are trimmed.
  workRoot: string;
  workspace: WorkspaceShape;
  // Directories outside staging the invocation may read: the gsd-core directory, the agents directory and the
  // realpath of each allowed skill.
  readRoots: readonly string[];
  strategy?: BashStrategy;
  // SHA-256 of the GSD preamble's first line, fingerprinted by the GSD adapter at inspect.
  preambleSha256?: string;
  // Lowers the subagent total for this invocation below the contract's (never raises it): the knowledge pass asks for one
  // subagent per 20 documents.
  subagentsTotal?: number;
}

const writeDirOf = (purpose: InvocationPurpose): string => INVOCATION_PURPOSES[purpose].writeDir;
const join = (base: string, rel: string): string => `${base}/${rel}`;
const uniqueSorted = (items: Iterable<string>): string[] => [...new Set(items)].sort();

export function computeInvocationScope(input: ScopeInput): InvocationScope {
  // WR-01: refuses (RootRefusedError) a work root that is not a normalized absolute path, before any part of the scope is built.
  const workRoot = normalizedAbsoluteRoot(input.workRoot, 'computeInvocationScope: workRoot');
  const { purpose, contract, workspace } = input;
  // The run purpose has no single write directory and no onboarding contract: computeRunScope builds its scope.
  if (purpose === 'run') throw new TypeError('computeInvocationScope: the run purpose is computed by computeRunScope');
  const spec: PurposeSpec = INVOCATION_PURPOSES[purpose];
  const readDir = spec.cwd === 'read-dir' ? (spec.readDir ?? writeDirOf(purpose)) : undefined;
  const staging = trimTrailingSlashes(input.stagingPath);
  const writeDir = spec.writeDir;

  // The contract is the authority: a purpose directory it does not authorize is not writable at all. A glob `dir/**` authorizes
  // the directory itself and everything under it, so the knowledge pass's nested output directory is covered by `.avarice-knowledge/**`.
  const authorized = contract.files.write[purpose].some((glob) => glob.endsWith('/**') && (writeDir === glob.slice(0, -3) || writeDir.startsWith(glob.slice(0, -2))));
  const writeRoots = authorized ? [join(staging, writeDir)] : [];

  const deny = new Set<string>();
  const slash = writeDir.indexOf('/');
  if (slash === -1) {
    // Top-level write directory: every other top-level entry (including .planning) is out of scope.
    for (const entry of workspace.topLevelEntries) if (entry !== writeDir) deny.add(join(staging, entry));
  } else {
    // Nested write directory (.planning/<leaf>): the parent stays writable to the shell as the cwd chain, so
    // its other entries are denied one by one, as is every other top-level entry. Only `.planning` has entries the workspace
    // lists (`.avarice-knowledge/.extraction` has no shell at all, so nothing below its parent is writable to one).
    const parent = writeDir.slice(0, slash);
    const leaf = writeDir.slice(slash + 1);
    for (const entry of workspace.topLevelEntries) if (entry !== parent) deny.add(join(staging, entry));
    if (parent === '.planning') for (const entry of workspace.planningEntries) if (entry !== leaf) deny.add(join(join(staging, parent), entry));
  }
  deny.add(join(staging, '.git'));
  deny.add(join(staging, '.planning/config.json'));
  for (const path of workspace.gitPaths) deny.add(trimTrailingSlashes(path));

  const home = trimTrailingSlashes(input.home);
  const repo = trimTrailingSlashes(input.repoPath);
  const dataRoot = trimTrailingSlashes(input.dataRoot);
  // The work root goes last so the existing entries keep their order; the Set lists a work root equal to another entry once.
  const denyRead = [...new Set([repo, dataRoot, join(home, '.ssh'), join(home, '.aws'), join(home, '.config/gh'), workRoot])];
  // Only the invocation's own staging path is re-allowed beneath the work root: not the onboarding directory above it, and not a sibling
  // whose ID shares a prefix (the path is compared whole, as a root, by the hook and by the sandbox).
  const allowRead = [...workspace.repoReadAllow.map(trimTrailingSlashes), staging];

  const subagents =
    purpose === 'intel' || purpose === 'knowledge'
      ? { total: 0, concurrent: 0 }
      : {
          total: Math.min(contract.budgets.subagentsTotal, input.subagentsTotal ?? contract.budgets.subagentsTotal),
          concurrent: Math.min(contract.budgets.subagentsConcurrent, input.subagentsTotal ?? contract.budgets.subagentsConcurrent),
        };

  return {
    purpose,
    cwd: readDir !== undefined ? join(staging, readDir) : staging,
    stagingPath: staging,
    repoPath: repo,
    dataRoot,
    writeRoots,
    denyWrite: uniqueSorted(deny),
    denyRead,
    denyReadGlobs: [...contract.files.secretGlobs],
    allowRead,
    // The knowledge pass reads its corpus and nothing else: no GSD directory, no skill directory, no other staging path.
    ...(readDir !== undefined ? { readConfine: [join(staging, readDir)] } : {}),
    readRoots: purpose === 'knowledge' ? [] : input.readRoots.map(trimTrailingSlashes),
    commands: {
      // No shell for the knowledge pass, whatever strategy is asked for.
      strategy: purpose === 'knowledge' ? 'none' : (input.strategy ?? ONBOARDING_BASH_STRATEGY),
      readOnly: purpose === 'knowledge' ? [] : [...READ_ONLY_COMMANDS],
      gsdReadVerbs: [...GSD_READ_VERBS[purpose]],
      deniedPrefixes: [...DENIED_COMMAND_PREFIXES],
      ...(input.preambleSha256 !== undefined ? { preambleSha256: input.preambleSha256 } : {}),
    },
    subagents,
    allowedDomains: [],
  };
}

// ---------------------------------------------------------------------------------------------------------
// The run purpose (plan 02-08)
// ---------------------------------------------------------------------------------------------------------

// The parts of a RunWorkspaceDescription (src/ports/run-workspace.ts) this module reads, declared here so the domain imports no port.
export interface RunWorkspaceShape {
  topLevelEntries: readonly string[];
  // Entry names of each directory above a write root (see runScopeDirs); a directory the clone does not have maps to [].
  entriesByDir: Readonly<Record<string, readonly string[]>>;
  gitPaths: readonly string[];
  repoReadAllow: readonly string[];
}

export interface RunScopeInput {
  contract: {
    files: Pick<RunContract['files'], 'write' | 'create' | 'artifacts' | 'protected' | 'secretGlobs'>;
    execution: Pick<RunContract['execution'], 'commands'>;
    budgets: Pick<RunContract['budgets'], 'subagentsTotal' | 'subagentsConcurrent'>;
    // The loop limits of the contract (CON-14); a contract stored before consecutiveSearches existed leaves the search limit at its preset value.
    escalation?: Partial<Pick<RunContract['escalation'], 'consecutiveDenials' | 'consecutiveSearches'>>;
  };
  // The run's clone (cwd and staging root); `{workRoot}/{runId}/clone`.
  clonePath: string;
  repoPath: string;
  dataRoot: string;
  home: string;
  workRoot: string;
  // `{workRoot}/{runId}/scratch`: writable and readable beside the clone; TMPDIR and the npm cache live under it.
  scratchDir: string;
  workspace: RunWorkspaceShape;
  readRoots: readonly string[];
  strategy?: BashStrategy;
  preambleSha256?: string;
}

// Paths the run may never write, whatever a write glob says: the clone's git directory and GSD's own configuration, which AVARICE sets
// before the run starts.
const RUN_ALWAYS_PROTECTED: readonly string[] = ['.git/**', '.planning/config.json'];
// The only denied prefixes that may leave the list, and only when the contract lists a command that starts with the word.
const RUN_EXEMPT_PREFIXES: readonly string[] = ['npm', 'npx'];
const WILDCARD_CHARS = /[*?[{]/;

const uniqueInOrder = (items: Iterable<string>): string[] => [...new Set(items)];

// The default parents of every AVARICE profile's roots (profile-paths.ts): all default data roots, the config home and all default work
// roots (which hold other profiles' run clones). A run may read none of them; its own clone and scratch, which lie under the work parent,
// are re-allowed one by one (plan 02-20: a declared command could read another profile's data root). A profile whose roots were placed
// elsewhere through AVARICE_DATA_ROOT, AVARICE_WORK_ROOT or AVARICE_CONFIG_HOME is not covered (docs/containment.md). `home` is the
// symlink-resolved home the credential directories already use.
export function defaultAvariceParents(home: string): string[] {
  const root = trimTrailingSlashes(home);
  return [join(root, '.local/share/avarice'), join(root, '.config/avarice'), join(root, '.local/share/avarice-work')];
}

// The credential stores of common tools, home-relative. Every sandboxed command, the model's host sandbox and the hook deny them. It is a
// deny list over reads that are otherwise allowed, so a credential stored elsewhere under the home is not covered (R-WR-03).
export const CREDENTIAL_PATHS: readonly string[] = [
  '.ssh',
  '.aws',
  '.config/gh',
  '.gnupg',
  '.netrc',
  '.npmrc',
  '.docker',
  '.kube',
  '.config/gcloud',
  'Library/Keychains',
  '.git-credentials',
  '.pgpass',
];

// CREDENTIAL_PATHS under `home` (the symlink-resolved home the other roots use), in list order.
export function credentialPaths(home: string): string[] {
  const root = trimTrailingSlashes(home);
  return CREDENTIAL_PATHS.map((rel) => join(root, rel));
}
const isUsableGlob = (glob: string): boolean => glob !== '' && !glob.startsWith('/') && !glob.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');

// The static prefix of a glob: the segments before the first one holding a wildcard. A glob with no wildcard names one path (a file root).
function globRoot(glob: string): { prefix: string; literal: boolean } {
  const segments = glob.split('/');
  const wild = segments.findIndex((segment) => WILDCARD_CHARS.test(segment));
  return wild === -1 ? { prefix: glob, literal: true } : { prefix: segments.slice(0, wild).join('/'), literal: false };
}

const isUnder = (path: string, root: string): boolean => root === '' || path === root || path.startsWith(`${root}/`);

// Directory roots and file roots of a set of globs, with every root another root already holds dropped. A directory root of '' is the
// clone itself.
function runRoots(globs: readonly string[]): { dirs: string[]; files: string[] } {
  const dirs = new Set<string>();
  const files = new Set<string>();
  for (const glob of globs) {
    const { prefix, literal } = globRoot(glob);
    (literal ? files : dirs).add(prefix);
  }
  const keptDirs = [...dirs].filter((dir) => ![...dirs].some((other) => other !== dir && isUnder(dir, other)));
  const keptFiles = [...files].filter((file) => !keptDirs.some((dir) => isUnder(file, dir)));
  return { dirs: keptDirs.sort(), files: keptFiles.sort() };
}

function runWriteGlobs(files: Pick<RunContract['files'], 'write' | 'create' | 'artifacts'>): string[] {
  return uniqueInOrder([...files.write, ...files.create, ...files.artifacts].filter(isUsableGlob));
}

// The directories whose entry lists computeRunScope needs: every directory above a write root, so the caller asks the workspace for
// exactly these (RunWorkspace.describe) and a directory the scope cannot enumerate is never left open. A write root itself is not listed.
export function runScopeDirs(files: Pick<RunContract['files'], 'write' | 'create' | 'artifacts'>): string[] {
  const { dirs, files: fileRoots } = runRoots(runWriteGlobs(files));
  const above = new Set<string>();
  for (const root of [...dirs, ...fileRoots]) {
    const segments = root.split('/');
    for (let end = 1; end < segments.length; end += 1) above.add(segments.slice(0, end).join('/'));
  }
  return [...above].sort();
}

// Contract commands to the words the hook compares. An entry that could chain, redirect or substitute, one that starts with a word the
// contract may never grant, and one that starts with a prefix that stays denied is dropped, so nothing here can reopen a Phase 1 denial.
function parseAgentCommands(commands: readonly string[], stillDenied: readonly string[]): AgentCommand[] {
  const out = new Map<string, AgentCommand>();
  for (const command of commands) {
    const tokens = command.split(' ');
    // eslint-disable-next-line no-control-regex
    if (tokens.some((token) => token === '' || /[\u0000-\u001f\u007f]/.test(token))) continue;
    const paths = tokens[tokens.length - 1] === '<paths>';
    const words = paths ? tokens.slice(0, -1) : tokens;
    if (words.length === 0 || words.some((word) => /[;&|$`\\<>'"]/.test(word))) continue;
    if (isRefusedAgentCommand(words[0] as string)) continue;
    if (stillDenied.some((prefix) => prefix.split(' ').every((word, i) => words[i] === word))) continue;
    out.set(`${paths ? 'p' : 'x'} ${words.join(' ')}`, { words, paths });
  }
  return [...out.values()];
}

export function computeRunScope(input: RunScopeInput): InvocationScope {
  // The same refusal as Phase 1 (WR-01), for every root this function turns into a rule: a relative or non-normalized root would match
  // no canonical path, so the rule would not apply.
  const workRoot = normalizedAbsoluteRoot(input.workRoot, 'computeRunScope: workRoot');
  const clone = normalizedAbsoluteRoot(input.clonePath, 'computeRunScope: clonePath');
  const scratch = normalizedAbsoluteRoot(input.scratchDir, 'computeRunScope: scratchDir');
  const { contract, workspace } = input;
  const at = (rel: string): string => (rel === '' ? clone : join(clone, rel));

  const writeGlobs = runWriteGlobs(contract.files);
  const { dirs, files } = runRoots(writeGlobs);
  const targets = [...dirs, ...files];

  // Every existing entry on the ancestor chain of a write root that is not itself on a write root's path: the sandbox always lets a
  // shell write under the working directory, and a denyWrite beats an allowWrite beneath it, so each is denied one by one (spike S0-B).
  // Entries created later at unlisted places are the diff gate's to catch.
  const deny = new Set<string>();
  const visit = (dir: string): void => {
    const names = dir === '' ? workspace.topLevelEntries : workspace.entriesByDir[dir];
    if (names === undefined) {
      throw new TypeError(`computeRunScope: workspace.entriesByDir has no listing for ${JSON.stringify(dir)}, a directory above a write root (ask the workspace for runScopeDirs)`);
    }
    for (const name of names) {
      const rel = dir === '' ? name : `${dir}/${name}`;
      if (targets.includes(rel)) continue;
      if (targets.some((target) => target.startsWith(`${rel}/`))) visit(rel);
      else deny.add(at(rel));
    }
  };
  if (!dirs.includes('')) visit('');

  // Every existing protected path: the static prefix of each protected glob, and every listed entry the glob matches.
  const protectedGlobs = uniqueInOrder([...contract.files.protected, ...RUN_ALWAYS_PROTECTED].filter(isUsableGlob));
  const listed = [...workspace.topLevelEntries, ...Object.entries(workspace.entriesByDir).flatMap(([dir, names]) => names.map((name) => `${dir}/${name}`))];
  for (const glob of protectedGlobs) {
    const { prefix } = globRoot(glob);
    if (prefix !== '') deny.add(at(prefix));
  }
  for (const entry of listed) if (matchesAny(entry, protectedGlobs)) deny.add(at(entry));

  deny.add(at('.git'));
  for (const path of workspace.gitPaths) deny.add(trimTrailingSlashes(path));
  const home = trimTrailingSlashes(input.home);
  const repo = trimTrailingSlashes(input.repoPath);
  const dataRoot = trimTrailingSlashes(input.dataRoot);
  const credentialDirs = [join(home, '.ssh'), join(home, '.aws'), join(home, '.config/gh')];
  // The Phase 1 data-root and credential denials, as write denials too.
  deny.add(dataRoot);
  for (const path of credentialDirs) deny.add(path);

  // npm and npx leave the denied prefixes only for a contract-listed exact form; everything else keeps its Phase 1 denial.
  const base = DENIED_COMMAND_PREFIXES.filter((prefix) => !RUN_EXEMPT_PREFIXES.includes(prefix));
  const agentCommands = parseAgentCommands(contract.execution.commands, base);
  const deniedPrefixes = DENIED_COMMAND_PREFIXES.filter((prefix) => !RUN_EXEMPT_PREFIXES.includes(prefix) || !agentCommands.some((command) => command.words[0] === prefix));

  return {
    purpose: 'run',
    cwd: clone,
    stagingPath: clone,
    repoPath: repo,
    dataRoot,
    writeRoots: dirs.map(at),
    writeFiles: files.map(at),
    writeGlobs,
    protectedGlobs,
    scratchDir: scratch,
    deniedTools: ['AskUserQuestion'],
    denyBackgroundShell: true,
    readBeforeEdit: true,
    escalation: {
      consecutiveDenials: contract.escalation?.consecutiveDenials ?? ROUTINE_PRESET.escalation.consecutiveDenials,
      consecutiveSearches: contract.escalation?.consecutiveSearches ?? ROUTINE_PRESET.escalation.consecutiveSearches,
    },
    denyWrite: uniqueSorted(deny),
    // The own clone and scratch are the only places under the work root the run may read: another run's clone, whose ID may share a
    // prefix with this one, is compared whole by the hook and the sandbox and stays denied.
    denyRead: uniqueInOrder([repo, dataRoot, ...credentialDirs, workRoot, ...defaultAvariceParents(home)]),
    denyReadGlobs: [...contract.files.secretGlobs],
    allowRead: [...workspace.repoReadAllow.map(trimTrailingSlashes), clone, scratch],
    readRoots: input.readRoots.map(trimTrailingSlashes),
    commands: {
      strategy: input.strategy ?? ONBOARDING_BASH_STRATEGY,
      readOnly: [...READ_ONLY_COMMANDS],
      gsdReadVerbs: [...GSD_READ_VERBS.run],
      deniedPrefixes,
      agentCommands,
      ...(input.preambleSha256 !== undefined ? { preambleSha256: input.preambleSha256 } : {}),
    },
    subagents: { total: contract.budgets.subagentsTotal, concurrent: contract.budgets.subagentsConcurrent },
    // An agent invocation never gets a network domain or a loopback allowance (CON-2, CON-5).
    allowedDomains: [],
  };
}
