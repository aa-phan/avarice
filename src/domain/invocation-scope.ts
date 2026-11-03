// Vendor-neutral write, read and command scope of one contained invocation (ONB-3, ONB-4, CON-2, CON-5).
// Pure: every path arrives as a string, the host adapter turns the scope into its own settings, and the hook
// (plan 01-12) turns the same scope into its policy. Nothing here knows Claude Code.
//
// Why denyWrite lists every existing out-of-scope entry (spike S0-B, docs/containment.md): the working
// directory is always writable to a sandboxed shell, and a denyWrite on a path overrides an allowWrite beneath
// it, so the only way to keep a shell out of `src/` is to deny each existing entry one by one. Entries created
// later at unlisted locations are caught by the staging diff gate, not prevented.
import type { OnboardingContract } from './onboarding-contract.ts';

export type InvocationPurpose = 'map' | 'intel' | 'knowledge';

// How Bash commands are admitted under dontAsk (spike S0-A, 01-RESEARCH "Bash allow-list under dontAsk").
//   blanket-bash-hook-identity  `Bash` is allowed; the AVARICE PreToolUse hook admits only commands matching the
//                               identity rules (GSD preamble fingerprint then a read verb, the read-only command
//                               set), and the sandbox confines the effects of anything that slips through
//   narrow-rules                `Bash(cmd:*)` allow rules only
//   hook-allow                  no Bash allow rule; the hook returns allow for identity-matching commands
export type BashStrategy = 'blanket-bash-hook-identity' | 'narrow-rules' | 'hook-allow';

// Owner decision of plan 01-11 Task 1 (checkpoint:decision, resolved 2026-11-02): blanket Bash with the hook as
// the command-identity control. S0-A showed that skills pre-approve Bash, that the GSD preamble is a 2.5 KB
// compound line, and that a hook deny holds even against the skill grant.
export const ONBOARDING_BASH_STRATEGY = 'blanket-bash-hook-identity' as BashStrategy;

export interface PurposeSpec {
  // Repository-relative directory the agent may write; AVARICE pre-creates it.
  writeDir: string;
  // `staging`: the invocation runs in the staging root (GSD hard-codes <cwd>/.planning).
  // `write-dir`: it runs in the write directory itself, so its own tree is the only cwd-writable area.
  cwd: 'staging' | 'write-dir';
}

export const INVOCATION_PURPOSES = {
  map: { writeDir: '.planning/codebase', cwd: 'staging' },
  intel: { writeDir: '.planning/intel', cwd: 'staging' },
  knowledge: { writeDir: '.avarice-knowledge', cwd: 'write-dir' },
} as const satisfies Record<InvocationPurpose, PurposeSpec>;

// What each contained invocation may load: the skills the generated plugin directory links and the agents the
// generated --agents file carries. map: the fast and full map skill and its mapper agent. intel: no skill, because
// `claude -p --agent gsd-intel-updater` runs the agent directly (S0-D). knowledge: the graphify skill.
export const PURPOSE_EXTENSIONS: Readonly<Record<InvocationPurpose, { skills: readonly string[]; agents: readonly string[] }>> = {
  map: { skills: ['gsd-map-codebase'], agents: ['gsd-codebase-mapper'] },
  intel: { skills: [], agents: ['gsd-intel-updater'] },
  knowledge: { skills: ['graphify'], agents: [] },
};

// Subagent types a purpose may start besides the agents it loads (PURPOSE_EXTENSIONS.agents are always allowed). Built-in
// types need no agent file. The graphify skill spawns one `general-purpose` subagent per chunk of documents (spike S0-G,
// by_type general-purpose: 1), so the knowledge pass admits exactly that type; map and intel admit none beyond their agents.
export const PURPOSE_SUBAGENT_TYPES: Readonly<Record<InvocationPurpose, readonly string[]>> = {
  map: [],
  intel: [],
  knowledge: ['general-purpose'],
};

// Commands the hook admits without a GSD verb. `find` is admitted only without the actions in
// FIND_DENIED_ACTIONS; the other entries are admitted as written (the hook also refuses redirections, `git -c`
// and `git log --output`).
export const READ_ONLY_COMMANDS: readonly string[] = [
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'find',
  'grep',
  'git ls-files',
  'git log',
  'git rev-parse',
  'git status',
  'git show',
];

export const FIND_DENIED_ACTIONS: readonly string[] = [
  '-exec',
  '-execdir',
  '-ok',
  '-okdir',
  '-delete',
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
  knowledge: GSD_BASE_VERBS,
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

export interface InvocationScope {
  purpose: InvocationPurpose;
  cwd: string;
  stagingPath: string;
  repoPath: string;
  dataRoot: string;
  writeRoots: string[];
  denyWrite: string[];
  denyRead: string[];
  // Repository-relative globs (secret-bearing files) the agent must not read inside staging.
  denyReadGlobs: string[];
  allowRead: string[];
  readRoots: string[];
  commands: {
    strategy: BashStrategy;
    readOnly: string[];
    gsdReadVerbs: string[];
    deniedPrefixes: string[];
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

const trimTrailingSlashes = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, '') : path);
const join = (base: string, rel: string): string => `${base}/${rel}`;
const uniqueSorted = (items: Iterable<string>): string[] => [...new Set(items)].sort();

export function computeInvocationScope(input: ScopeInput): InvocationScope {
  const { purpose, contract, workspace } = input;
  const spec: PurposeSpec = INVOCATION_PURPOSES[purpose];
  const staging = trimTrailingSlashes(input.stagingPath);
  const writeDir = spec.writeDir;

  // The contract is the authority: a purpose directory it does not authorize is not writable at all.
  const authorized = contract.files.write[purpose].includes(`${writeDir}/**`);
  const writeRoots = authorized ? [join(staging, writeDir)] : [];

  const deny = new Set<string>();
  const slash = writeDir.indexOf('/');
  if (slash === -1) {
    // Top-level write directory: every other top-level entry (including .planning) is out of scope.
    for (const entry of workspace.topLevelEntries) if (entry !== writeDir) deny.add(join(staging, entry));
  } else {
    // Nested write directory (.planning/<leaf>): the parent stays writable to the shell as the cwd chain, so
    // its other entries are denied one by one, as is every other top-level entry.
    const parent = writeDir.slice(0, slash);
    const leaf = writeDir.slice(slash + 1);
    for (const entry of workspace.topLevelEntries) if (entry !== parent) deny.add(join(staging, entry));
    for (const entry of workspace.planningEntries) if (entry !== leaf) deny.add(join(join(staging, parent), entry));
  }
  deny.add(join(staging, '.git'));
  deny.add(join(staging, '.planning/config.json'));
  for (const path of workspace.gitPaths) deny.add(trimTrailingSlashes(path));

  const home = trimTrailingSlashes(input.home);
  const repo = trimTrailingSlashes(input.repoPath);
  const dataRoot = trimTrailingSlashes(input.dataRoot);
  const denyRead = [...new Set([repo, dataRoot, join(home, '.ssh'), join(home, '.aws'), join(home, '.config/gh')])];

  const subagents =
    purpose === 'intel'
      ? { total: 0, concurrent: 0 }
      : {
          total: Math.min(contract.budgets.subagentsTotal, input.subagentsTotal ?? contract.budgets.subagentsTotal),
          concurrent: Math.min(contract.budgets.subagentsConcurrent, input.subagentsTotal ?? contract.budgets.subagentsConcurrent),
        };

  return {
    purpose,
    cwd: spec.cwd === 'write-dir' ? join(staging, writeDir) : staging,
    stagingPath: staging,
    repoPath: repo,
    dataRoot,
    writeRoots,
    denyWrite: uniqueSorted(deny),
    denyRead,
    denyReadGlobs: [...contract.files.secretGlobs],
    allowRead: workspace.repoReadAllow.map(trimTrailingSlashes),
    readRoots: input.readRoots.map(trimTrailingSlashes),
    commands: {
      strategy: input.strategy ?? ONBOARDING_BASH_STRATEGY,
      readOnly: [...READ_ONLY_COMMANDS],
      gsdReadVerbs: [...GSD_READ_VERBS[purpose]],
      deniedPrefixes: [...DENIED_COMMAND_PREFIXES],
      ...(input.preambleSha256 !== undefined ? { preambleSha256: input.preambleSha256 } : {}),
    },
    subagents,
    allowedDomains: [],
  };
}
