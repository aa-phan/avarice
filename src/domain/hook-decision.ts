// Pure decision over normalized tool calls for AVARICE's PreToolUse hook (CON-2, CON-3, CON-13, ONB-3, ONB-4).
// The hook entry (src/hook/pre-tool-use.ts) reads the host's JSON, normalizes it with normalizeToolCall and asks
// decideToolCall; this file holds every rule and nothing that touches the filesystem: canon(path) is injected
// and returns the canonical path (symlinks and `..` resolved through the nearest existing parent) or null.
//
// Strings only, no `node:path`: policy paths are already canonical (the policy writer canonicalizes them), and a
// path is "under" a root when it equals it or continues with `/`.
//
// What `allow` means: for the blanket and narrow strategies it is "defer to the host's permission rules" (the
// hook prints nothing); `explicit: true` (hook-allow strategy, shell only) makes the hook print an allow.
import { isRefusedAgentCommand } from './conventions.ts';
import { matchesAny } from './glob.ts';
import { sha256Hex } from './digest.ts';
import { FIND_DENIED_ACTIONS } from './invocation-scope.ts';
import type { AgentCommand, BashStrategy, InvocationPurpose } from './invocation-scope.ts';

export type NormalizedToolCall =
  | { kind: 'file-write'; tool: string; paths: string[] }
  | { kind: 'file-read'; tool: string; paths: string[] }
  | { kind: 'search'; tool: string; path: string; patternRoot?: string }
  | { kind: 'shell'; command: string; background: boolean; cwd: string }
  | { kind: 'subagent'; subagentType: string | null }
  | { kind: 'web'; tool: string }
  | { kind: 'meta'; tool: string }
  | { kind: 'other'; tool: string };

export interface HookPolicy {
  schema: 1;
  onboardingId: string;
  runId: string;
  invocationId: string;
  purpose: InvocationPurpose;
  ledgerPath: string;
  stagingPath: string;
  writeRoots: string[];
  denyRead: string[];
  allowRead: string[];
  // Repository-relative globs of secret-bearing files, matched below stagingPath.
  denyReadGlobs: string[];
  commands: {
    strategy: BashStrategy;
    readOnly: string[];
    gsdReadVerbs: string[];
    deniedPrefixes: string[];
    // SHA-256 and byte length of the GSD preamble's first line (fingerprinted at gsd inspect).
    preambleSha256?: string;
    preambleLength?: number;
  };
  // When present, every read and search must stay under one of these roots (the knowledge purpose reads only its corpus).
  readConfine?: string[];
  // Canonical directories outside staging the invocation may read: the gsd-core and agents directories and each allowed skill's
  // realpath (InvocationScope.readRoots). Absent means none, so reads stay confined to staging and allowRead, never wider.
  readRoots?: string[];
  // Agent types the invocation may start (the names in its --agents file).
  subagentTypes: string[];
  // The most subagents the invocation may have in flight at once (the contract's subagentsConcurrent, as the scope computes it).
  // The hook counts them in the ledger; a policy without the limit is refused, because it would leave the control off (O-1).
  subagentsConcurrent: number;
  // The run purpose (plan 02-08). `writeGlobs` and `protectedGlobs` are clone-relative: with `writeGlobs` present a write below
  // stagingPath is allowed only when its clone-relative path matches a write glob and no protected glob, and a write outside
  // stagingPath only under a writeRoot (the scratch directory). Absent means the Phase 1 rule: a path under a write root.
  writeGlobs?: string[];
  protectedGlobs?: string[];
  // Shell commands admitted by exact argv match (the contract's execution.commands), ahead of the denied prefixes.
  agentCommands?: AgentCommand[];
  // Tools refused by name with rule `no-human-prompts` (AskUserQuestion), and whether a shell call with run_in_background is refused.
  deniedTools?: string[];
  denyBackgroundShell?: boolean;
  // The run purpose (plan 02-11): a file edit needs a recorded read of the same file by the same agent in this invocation, and the
  // file must not have changed since (CON-7); `loopLimits` stop the invocation on repeated denials or ineffective searches (CON-14).
  readBeforeEdit?: boolean;
  loopLimits?: LoopLimits;
}

export interface LoopLimits {
  consecutiveDenials: number;
  consecutiveSearches: number;
}

export interface HookDecision {
  decision: 'allow' | 'deny';
  rule: string;
  // The budget one allowed call charges.
  budget?: 'toolCalls' | 'subagentsTotal';
  // The hook prints an allow (hook-allow strategy); otherwise an allow is silent.
  explicit?: boolean;
  // What the model is told besides the rule (a deny only): the corrective step.
  reason?: string;
}

export type Canon = (path: string) => string | null;
export type NormalizeResult = { ok: true; call: NormalizedToolCall } | { ok: false; reason: string };
export type PolicyResult = { ok: true; policy: HookPolicy } | { ok: false; reason: string };

// The rule of an Agent call refused because the invocation already has `subagentsConcurrent` subagents in flight (O-1).
export const SUBAGENT_CONCURRENT_RULE = 'budget:subagentsConcurrent';

const GENERAL_PURPOSE = 'general-purpose';
const MAX_COMMAND_CHARS = 16_384;
const WRITE_TOOLS: Readonly<Record<string, string>> = { Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };
const META_TOOLS: ReadonlySet<string> = new Set(['Skill', 'TodoWrite', 'TaskOutput', 'BashOutput']);
const WEB_TOOLS: ReadonlySet<string> = new Set(['WebFetch', 'WebSearch']);
const GIT_DENIED_OPTIONS: readonly string[] = ['--output', '--ext-diff', '--textconv'];
// GSD's own follow-up to `INIT=$(gsd_run query init.*)` when the result is large (the file holds GSD's output).
const GSD_INIT_FILE_LINE = 'if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi';

const deny = (rule: string): HookDecision => ({ decision: 'deny', rule });

// ---------------------------------------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------------------------------------

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const absolutize = (cwd: string, path: string): string => (path.startsWith('/') ? path : `${cwd.replace(/\/+$/, '')}/${path}`);

function requiredPath(input: Record<string, unknown>, key: string, cwd: string): string | null {
  const value = input[key];
  return typeof value === 'string' && value !== '' ? absolutize(cwd, value) : null;
}

export function normalizeToolCall(tool: string, input: Record<string, unknown>, cwd: string): NormalizeResult {
  const writeKey = WRITE_TOOLS[tool];
  if (writeKey !== undefined) {
    const path = requiredPath(input, writeKey, cwd);
    return path === null ? { ok: false, reason: `${tool} input has no ${writeKey}` } : { ok: true, call: { kind: 'file-write', tool, paths: [path] } };
  }
  switch (tool) {
    case 'Read': {
      const path = requiredPath(input, 'file_path', cwd);
      return path === null ? { ok: false, reason: 'Read input has no file_path' } : { ok: true, call: { kind: 'file-read', tool, paths: [path] } };
    }
    case 'Grep':
    case 'Glob': {
      const given = input['path'];
      if (given !== undefined && (typeof given !== 'string' || given === '')) return { ok: false, reason: `${tool} path is not a string` };
      const call: Extract<NormalizedToolCall, { kind: 'search' }> = { kind: 'search', tool, path: typeof given === 'string' ? absolutize(cwd, given) : cwd };
      const pattern = input['pattern'];
      if (tool === 'Glob' && typeof pattern === 'string' && pattern.startsWith('/')) {
        // An absolute glob pattern names its own root: the literal directory prefix before the first wildcard.
        const literal = pattern.split(/[*?[{]/, 1)[0] ?? '/';
        call.patternRoot = literal.endsWith('/') ? literal : literal.slice(0, literal.lastIndexOf('/') + 1);
      }
      return { ok: true, call };
    }
    case 'Bash': {
      const command = input['command'];
      if (typeof command !== 'string') return { ok: false, reason: 'Bash input has no command' };
      return { ok: true, call: { kind: 'shell', command, background: input['run_in_background'] === true, cwd } };
    }
    case 'Agent':
    case 'Task': {
      const type = input['subagent_type'];
      return { ok: true, call: { kind: 'subagent', subagentType: typeof type === 'string' && type !== '' ? type : null } };
    }
    default:
      if (WEB_TOOLS.has(tool)) return { ok: true, call: { kind: 'web', tool } };
      if (META_TOOLS.has(tool)) return { ok: true, call: { kind: 'meta', tool } };
      return { ok: true, call: { kind: 'other', tool } };
  }
}

// ---------------------------------------------------------------------------------------------------------
// Policy parsing
// ---------------------------------------------------------------------------------------------------------

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');
const STRATEGIES: readonly string[] = ['blanket-bash-hook-identity', 'narrow-rules', 'hook-allow', 'none'];
const PURPOSES: readonly string[] = ['map', 'intel', 'knowledge', 'run'];

export function parseHookPolicy(raw: unknown): PolicyResult {
  const bad = (reason: string): PolicyResult => ({ ok: false, reason: `hook policy ${reason}` });
  if (!isObject(raw)) return bad('is not an object');
  if (raw['schema'] !== 1) return bad('has an unknown schema');
  for (const key of ['onboardingId', 'runId', 'invocationId', 'ledgerPath', 'stagingPath']) {
    if (typeof raw[key] !== 'string' || raw[key] === '') return bad(`needs a string ${key}`);
  }
  if (typeof raw['purpose'] !== 'string' || !PURPOSES.includes(raw['purpose'])) return bad('has an unknown purpose');
  for (const key of ['writeRoots', 'denyRead', 'allowRead', 'denyReadGlobs', 'subagentTypes']) {
    if (!isStrings(raw[key])) return bad(`needs a list of strings ${key}`);
  }
  const commands = raw['commands'];
  if (!isObject(commands)) return bad('needs commands');
  if (typeof commands['strategy'] !== 'string' || !STRATEGIES.includes(commands['strategy'])) return bad('has an unknown command strategy');
  for (const key of ['readOnly', 'gsdReadVerbs', 'deniedPrefixes']) {
    if (!isStrings(commands[key])) return bad(`needs a list of strings commands.${key}`);
  }
  if (raw['readConfine'] !== undefined && !isStrings(raw['readConfine'])) return bad('needs a list of strings readConfine');
  if (raw['readRoots'] !== undefined && !isStrings(raw['readRoots'])) return bad('needs a list of strings readRoots');
  for (const key of ['writeGlobs', 'protectedGlobs', 'deniedTools']) {
    if (raw[key] !== undefined && !isStrings(raw[key])) return bad(`needs a list of strings ${key}`);
  }
  // A policy with write globs and no protected list would leave the protected check off; refuse it rather than assume an empty list.
  if (raw['writeGlobs'] !== undefined && raw['protectedGlobs'] === undefined) return bad('has writeGlobs without protectedGlobs');
  if (raw['denyBackgroundShell'] !== undefined && typeof raw['denyBackgroundShell'] !== 'boolean') return bad('has a malformed denyBackgroundShell');
  if (raw['readBeforeEdit'] !== undefined && typeof raw['readBeforeEdit'] !== 'boolean') return bad('has a malformed readBeforeEdit');
  const loopLimits = raw['loopLimits'];
  if (loopLimits !== undefined) {
    const count = (value: unknown): boolean => typeof value === 'number' && Number.isInteger(value) && value >= 0;
    if (!isObject(loopLimits) || !count(loopLimits['consecutiveDenials']) || !count(loopLimits['consecutiveSearches'])) return bad('has malformed loopLimits');
  }
  const agentCommands = raw['agentCommands'];
  if (agentCommands !== undefined) {
    const wellFormed = Array.isArray(agentCommands) && agentCommands.every((c) => isObject(c) && isStrings(c['words']) && c['words'].length > 0 && typeof c['paths'] === 'boolean');
    if (!wellFormed) return bad('has malformed agentCommands');
  }
  if (!(typeof raw['subagentsConcurrent'] === 'number' && Number.isInteger(raw['subagentsConcurrent']) && raw['subagentsConcurrent'] >= 0)) {
    return bad('needs a non-negative integer subagentsConcurrent');
  }
  if (commands['preambleSha256'] !== undefined && typeof commands['preambleSha256'] !== 'string') return bad('has a malformed preambleSha256');
  if (commands['preambleLength'] !== undefined && !(typeof commands['preambleLength'] === 'number' && Number.isInteger(commands['preambleLength']) && commands['preambleLength'] > 0)) {
    return bad('has a malformed preambleLength');
  }
  return { ok: true, policy: raw as unknown as HookPolicy };
}

// ---------------------------------------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------------------------------------

const trimSlashes = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, '') : path);
const under = (path: string, root: string): boolean => {
  const r = trimSlashes(root);
  return path === r || path.startsWith(r === '/' ? '/' : `${r}/`);
};

// Why a canonical path may not be read, or null. The rules apply in a fixed order: the knowledge purpose's readConfine, then
// deny-read (a denied root, unless re-allowed), then the allow-list (staging, readRoots, allowRead: anything else is
// outside-read-set), then the secret globs below staging (deny-secret-read). File-read, search and shell words all reach this
// function through checkRead, so one rule confines every read kind.
function readRule(canonical: string, policy: HookPolicy): string | null {
  // A purpose that reads only its corpus (the knowledge pass): anything else, even inside staging, is outside its read set.
  if (policy.readConfine !== undefined && !policy.readConfine.some((root) => under(canonical, root))) return 'outside-read-set';
  if (policy.denyRead.some((root) => under(canonical, root)) && !policy.allowRead.some((root) => under(canonical, root))) return 'deny-read';
  const allowed = [policy.stagingPath, ...(policy.readRoots ?? []), ...policy.allowRead];
  if (!allowed.some((root) => under(canonical, root))) return 'outside-read-set';
  const staging = trimSlashes(policy.stagingPath);
  if (under(canonical, staging) && canonical !== staging && matchesAny(canonical.slice(staging.length + 1), policy.denyReadGlobs)) return 'deny-secret-read';
  return null;
}

function checkRead(paths: readonly string[], policy: HookPolicy, canon: Canon): string | null {
  for (const path of paths) {
    const canonical = canon(path);
    if (canonical === null) return 'unresolvable-path';
    const rule = readRule(canonical, policy);
    if (rule !== null) return rule;
  }
  return null;
}

// The run purpose's write rule (policy.writeGlobs present): below stagingPath the clone-relative path must match a write glob, and a
// protected glob wins over it (`protected-path`); outside stagingPath only a write root admits it (the scratch directory), so another
// run's clone, whose ID may share a prefix with this one, is outside.
function checkGlobWrite(canonical: string, writeGlobs: readonly string[], policy: HookPolicy): string | null {
  const staging = trimSlashes(policy.stagingPath);
  if (!under(canonical, staging) || canonical === staging) return policy.writeRoots.some((root) => under(canonical, root)) ? null : 'outside-write-set';
  const relative = canonical.slice(staging.length + 1);
  if (matchesAny(relative, policy.protectedGlobs ?? [])) return 'protected-path';
  return matchesAny(relative, writeGlobs) ? null : 'outside-write-set';
}

function checkWrite(paths: readonly string[], policy: HookPolicy, canon: Canon): string | null {
  for (const path of paths) {
    const canonical = canon(path);
    if (canonical === null) return 'unresolvable-path';
    const rule = policy.writeGlobs !== undefined ? checkGlobWrite(canonical, policy.writeGlobs, policy) : policy.writeRoots.some((root) => under(canonical, root)) ? null : 'outside-write-set';
    if (rule !== null) return rule;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Bash command identity
// ---------------------------------------------------------------------------------------------------------

// One pipeline segment: its words, and whether any of them holds an unquoted `*`, `?`, `[` or `{` (the shell would expand it
// into names the path check never sees, MF-04).
interface Segment {
  words: string[];
  expands: boolean;
}

const EXPANSION_CHARS = '*?[{';

// Splits one line into pipeline segments of words, or null when the line uses anything but quoting and `|`.
// Outside quotes: `;`, `&`, `<`, `>`, backtick, `$`, `(`, `)`, `\`, newline, a leading `~` or `#` all refuse. Inside
// double quotes `$`, backtick and `\` refuse (they would expand); single quotes are literal. `||` refuses. An unquoted
// `*`, `?`, `[` or `{` is kept in the word and marks the segment `expands`.
function lex(line: string): Segment[] | null {
  const segments: Segment[] = [{ words: [], expands: false }];
  let word = '';
  let inWord = false;
  const flush = (): void => {
    if (inWord) (segments[segments.length - 1] as Segment).words.push(word);
    word = '';
    inWord = false;
  };
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i] as string;
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end === -1) return null;
      word += line.slice(i + 1, end);
      inWord = true;
      i = end;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < line.length && line[j] !== '"'; j += 1) {
        if ('$`\\'.includes(line[j] as string)) return null;
        word += line[j];
      }
      if (j >= line.length) return null;
      inWord = true;
      i = j;
    } else if (c === ' ' || c === '\t') {
      flush();
    } else if (c === '|') {
      if (line[i + 1] === '|') return null;
      flush();
      if ((segments[segments.length - 1] as Segment).words.length === 0) return null;
      segments.push({ words: [], expands: false });
    } else if (';&<>`$()\\\n\r'.includes(c) || (!inWord && (c === '~' || c === '#'))) {
      return null;
    } else {
      if (EXPANSION_CHARS.includes(c)) (segments[segments.length - 1] as Segment).expands = true;
      word += c;
      inWord = true;
    }
  }
  flush();
  return (segments[segments.length - 1] as Segment).words.length === 0 ? null : segments;
}

const startsWithWords = (words: readonly string[], prefix: readonly string[]): boolean => prefix.length > 0 && prefix.every((word, i) => words[i] === word);
const splitWords = (text: string): string[] => text.split(' ').filter((w) => w !== '');

// Short options that take a value, per read-only command entry (the matched READ_ONLY_COMMANDS entry joined with a space).
// An entry that is not listed takes none. `-OPATH` and `-O PATH` both name PATH as a value.
export const SHORT_VALUE_OPTIONS: Readonly<Record<string, string>> = {
  head: 'nc',
  tail: 'bnc',
  'git log': 'nSGOLUMCBl',
  'git show': 'nSGOLUMCBl',
  'git ls-files': 'xX',
  // `-u` of `git status` takes its mode only attached (`-uall`), so the next word is an operand, not a value.
  'git status': 'M',
};

// Options of a `gsd_run` read verb. GSD consumes `--cwd`, `--project-dir`, `--ws`, `--pick` and its other global options from any
// position, and `--cwd`/`--project-dir` redirect the whole command to another tree, so every option not listed here is refused
// `shell-gsd-option` (review WR-06). `--raw` is admitted for every verb. GSD_VALUE_OPTIONS lists, per GSD_READ_VERBS entry, the
// options that take one value. The lists come from GSD 1.17.0's agents and docs (agents/gsd-phase-researcher.md and
// docs/contracts-and-state.md show `graphify query <term> --budget <n>`); a verb that needs more must be added here with the GSD
// source line that shows it.
const GSD_FLAG_OPTIONS: readonly string[] = ['--raw'];
export const GSD_VALUE_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  'graphify query': ['--budget'],
  // agents/gsd-executor.md line 312: `gsd_run query config-get workflow.human_verify_mode --default end-of-phase --raw`.
  'query config-get': ['--default'],
};
// Boolean flags a verb takes besides `--raw` (plan 02-09, spike S2-B). Every other option stays `shell-gsd-option`.
//   - `query init.quick --validate`: quick.md line 122 sets VALIDATE_PARAM and line 125 passes it to `gsd_run query init.quick`; without
//     the flag the workflow cannot enter validate mode, which the run prompt asks for (`/gsd-quick --validate --text`).
export const GSD_VERB_FLAGS: Readonly<Record<string, readonly string[]>> = {
  'query init.quick': ['--validate'],
};
// Verbs whose first operand must be one of a fixed set (a name GSD's own workflow passes), so the verb cannot be aimed at an arbitrary
// key; anything else is refused `shell-gsd-operand`. Both verbs only read GSD's resolved configuration.
//   - `query config-get <key>`: quick.md lines 43 (response_language), 143 (workflow.use_worktrees), 144 (runtime) and 698 (commit_docs);
//     agents/gsd-executor.md lines 310-312 (workflow._auto_chain_active, workflow.auto_advance, workflow.human_verify_mode).
//   - `loop render-hooks <point>`: quick.md lines 289 (plan:pre) and 560 (execute:post).
export const GSD_OPERAND_NAMES: Readonly<Record<string, readonly string[]>> = {
  'query config-get': ['response_language', 'workflow.use_worktrees', 'runtime', 'workflow._auto_chain_active', 'workflow.auto_advance', 'workflow.human_verify_mode', 'commit_docs'],
  'loop render-hooks': ['plan:pre', 'execute:post'],
};
// Verbs whose operands GSD writes (`intel patch-meta <file>` rewrites `_meta.updated_at` in the named file).
const GSD_WRITE_OPERAND_VERBS: readonly string[] = ['intel patch-meta'];

// What the words after a read command's name say. The parser treats every operand and every attached or separate option
// value as a path candidate (fail closed: a non-path value such as a search pattern starting with `/` is judged as a path).
interface ReadArgs {
  // Words that are not options (and every word after a bare `--`): the paths.
  positional: string[];
  // Option values: the rest of a short cluster after a value letter, the next word when the letter ends the cluster, and `--name=value`.
  values: string[];
  // A character in a short cluster that is not an ASCII letter or digit and that no value-taking letter consumed.
  malformed: boolean;
}

const isAsciiAlphanumeric = (char: string): boolean => /^[A-Za-z0-9]$/.test(char);

function parseReadArgs(entryKey: string, args: readonly string[]): ReadArgs {
  const valueLetters = SHORT_VALUE_OPTIONS[entryKey] ?? '';
  const parsed: ReadArgs = { positional: [], values: [], malformed: false };
  let operandsOnly = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    // `-` alone is standard input: no path.
    if (arg === '-') continue;
    if (operandsOnly || !arg.startsWith('-')) {
      parsed.positional.push(arg);
    } else if (arg === '--') {
      operandsOnly = true;
    } else if (arg.startsWith('--')) {
      const equals = arg.indexOf('=');
      const value = equals === -1 ? null : arg.slice(equals + 1);
      if (value !== null && value !== '') parsed.values.push(value);
    } else if (!/^-[0-9]+$/.test(arg)) {
      // A cluster, read per character (`-pO/path` is p and the value of O).
      for (let k = 1; k < arg.length; k += 1) {
        const char = arg[k] as string;
        if (!isAsciiAlphanumeric(char)) {
          parsed.malformed = true;
          break;
        }
        if (!valueLetters.includes(char)) continue;
        const attached = arg.slice(k + 1);
        const value = attached !== '' ? attached : args[i + 1];
        if (attached === '' && value !== undefined) i += 1;
        if (value !== undefined) parsed.values.push(value);
        break;
      }
    }
  }
  return parsed;
}

const shellCwd = (call: Extract<NormalizedToolCall, { kind: 'shell' }>, policy: HookPolicy): string => (call.cwd.startsWith('/') ? call.cwd : policy.stagingPath);

// What a segment that matched no agent command and one that matched one both leave for the caller: only `agent-command` is reported
// by decideShell, as the rule of an allow that rests on a contract command.
interface LineSeen {
  agentCommand: boolean;
}

// The run purpose's contract commands (plan 02-08): a segment's words must equal an entry's words, or start with them when the entry
// ended in `<paths>` and every further word is a relative path that passes the read rule (an option is not a path, an absolute path is
// not relative, and a word the shell would expand is a path set nobody named). `undefined` is no entry matched, `null` is admitted,
// a string is the rule that refused it. An entry that starts with a word the contract may never grant is never matched, whatever the
// policy file says (RC-5).
function matchAgentCommand(words: readonly string[], expands: boolean, call: Extract<NormalizedToolCall, { kind: 'shell' }>, policy: HookPolicy, canon: Canon): string | null | undefined {
  let refusal: string | undefined;
  for (const entry of policy.agentCommands ?? []) {
    if (isRefusedAgentCommand(entry.words[0] as string)) continue;
    const exact = entry.words.length === words.length && entry.words.every((word, i) => words[i] === word);
    if (!exact && !(entry.paths && startsWithWords(words, entry.words))) continue;
    if (expands) {
      refusal ??= 'shell-syntax';
      continue;
    }
    const extra = words.slice(entry.words.length);
    if (extra.some((word) => word.startsWith('-') || word.startsWith('/'))) {
      refusal ??= 'shell-not-allowed';
      continue;
    }
    const cwd = shellCwd(call, policy);
    const rule = checkRead(extra.map((word) => absolutize(cwd, word)), policy, canon);
    if (rule === null) return null;
    refusal ??= rule;
  }
  return refusal;
}

// The words after a `gsd_run` read verb: an allow-list of options, then the read check on every operand and option value, then the
// write check on the operands of a verb that writes them (review WR-06). A term is not a path to GSD, but it is judged as one,
// the same fail-closed choice parseReadArgs makes.
function checkGsdArgs(verb: string, rest: readonly string[], cwd: string, policy: HookPolicy, canon: Canon): string | null {
  const valued = GSD_VALUE_OPTIONS[verb] ?? [];
  const flags = GSD_VERB_FLAGS[verb] ?? [];
  const operands: string[] = [];
  const optionValues: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const word = rest[i] as string;
    if (!word.startsWith('-')) {
      operands.push(word);
    } else if (GSD_FLAG_OPTIONS.includes(word) || flags.includes(word)) {
      continue;
    } else {
      const equals = word.indexOf('=');
      const name = equals === -1 ? word : word.slice(0, equals);
      if (!valued.includes(name)) return 'shell-gsd-option';
      const value = equals === -1 ? rest[i + 1] : word.slice(equals + 1);
      // A missing value, or a value that is itself an option (`--budget --cwd`), would let GSD read an option the list refuses.
      if (value === undefined || value.startsWith('-')) return 'shell-gsd-option';
      if (equals === -1) i += 1;
      optionValues.push(value);
    }
  }
  const allowedOperands = GSD_OPERAND_NAMES[verb];
  if (allowedOperands !== undefined && (operands.length !== 1 || !allowedOperands.includes(operands[0] as string))) return 'shell-gsd-operand';
  const named = [...operands, ...optionValues].map((word) => absolutize(cwd, word));
  const readRule = checkRead(named, policy, canon);
  if (readRule !== null) return readRule;
  if (GSD_WRITE_OPERAND_VERBS.includes(verb)) return checkWrite(operands.map((word) => absolutize(cwd, word)), policy, canon);
  return null;
}

// Git names an object by path in an operand (`<rev>:<path>`, `:<path>`, `:<stage>:<path>`), so the path part is a read like any other.
// A word git would split differently from this plain split (a brace, an index form that is a search or a pathspec) is refused.
const GIT_OBJECT_RULE = 'shell-git-object';

function checkGitObjects(operands: readonly string[], call: Extract<NormalizedToolCall, { kind: 'shell' }>, policy: HookPolicy, canon: Canon): string | null {
  for (const operand of operands) {
    if (!operand.includes(':')) continue;
    if (operand.includes('{') || operand.includes('}')) return GIT_OBJECT_RULE;
    const path = operand.startsWith(':') ? (/^:[0-3]:/.test(operand) ? operand.slice(3) : operand.slice(1)) : operand.slice(operand.indexOf(':') + 1);
    if (/^[/!(]/.test(path)) return GIT_OBJECT_RULE;
    // Git resolves the path from the top of the working copy; `./` and `../` forms resolve from the shell's directory. Both must pass.
    const rule = checkRead([absolutize(policy.stagingPath, path), absolutize(shellCwd(call, policy), path)], policy, canon);
    if (rule !== null) return rule;
  }
  return null;
}

// The options of an admitted git command that print no file content, per READ_ONLY_COMMANDS entry. shortFlags are the short option
// letters that take no value; shortValued the letters that take one (attached, or the next word); counts admits `-<digits>`; flags are
// long options without a value; valued are long options that need a non-empty `=value`. The lists are an allow-list compared whole,
// because git accepts an unambiguous abbreviation of a long option (`--pat` is `--patch`) and several spellings imply a patch. A
// `--format` placeholder names commit fields only, never a blob. `git show` takes no option: a commit prints its patch, and a blob or
// a tag pointing at one prints its content even with `-s`, which the hook cannot tell from a commit by the hash.
export interface GitOutputForm {
  shortFlags: string;
  shortValued: string;
  // Short option letters whose value is only the rest of the cluster (`-uall`); the next word is never their value.
  shortAttached: string;
  counts: boolean;
  flags: readonly string[];
  valued: readonly string[];
  objectOperandsOnly: boolean;
}

export const GIT_OUTPUT_FORMS: Readonly<Record<string, GitOutputForm>> = {
  'git log': {
    shortFlags: 's',
    shortValued: 'n',
    shortAttached: '',
    counts: true,
    flags: [
      '--oneline', '--abbrev-commit', '--no-abbrev-commit', '--all', '--branches', '--tags', '--remotes', '--reverse', '--no-merges', '--merges', '--first-parent',
      '--graph', '--decorate', '--no-decorate', '--follow', '--stat', '--shortstat', '--name-only', '--name-status', '--relative-date', '--pretty', '--no-color', '--no-patch',
    ],
    valued: ['--format', '--pretty', '--max-count', '--skip', '--since', '--until', '--after', '--before', '--author', '--committer', '--grep', '--date', '--decorate'],
    objectOperandsOnly: false,
  },
  'git status': {
    shortFlags: 'sbz',
    shortValued: '',
    shortAttached: 'u',
    counts: false,
    flags: [
      '--short', '--branch', '--porcelain', '--long', '--ignored', '--untracked-files', '--ahead-behind', '--no-ahead-behind', '--renames', '--no-renames', '--show-stash', '--null',
    ],
    valued: ['--porcelain', '--untracked-files', '--ignored', '--ignore-submodules', '--find-renames'],
    objectOperandsOnly: false,
  },
  'git show': { shortFlags: '', shortValued: '', shortAttached: '', counts: false, flags: [], valued: [], objectOperandsOnly: true },
};

const GIT_OUTPUT_RULE = 'shell-git-output';

// An option outside the allow-list is shell-git-output; `git show` also needs an object-by-path operand (shell-git-object otherwise).
function checkGitOutput(entryKey: string, args: readonly string[], operands: readonly string[]): string | null {
  const form = GIT_OUTPUT_FORMS[entryKey];
  if (form === undefined) return null;
  if (form.objectOperandsOnly) {
    if (args.some((arg) => arg.startsWith('-'))) return GIT_OUTPUT_RULE;
    return operands.length === 0 || operands.some((operand) => !operand.includes(':')) ? GIT_OBJECT_RULE : null;
  }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg === '--') break;
    // `-` alone is standard input; a word that is not an option is an operand.
    if (arg === '-' || !arg.startsWith('-')) continue;
    if (/^-[0-9]+$/.test(arg)) {
      if (form.counts) continue;
      return GIT_OUTPUT_RULE;
    }
    if (arg.startsWith('--')) {
      const equals = arg.indexOf('=');
      if (equals === -1 ? form.flags.includes(arg) : form.valued.includes(arg.slice(0, equals)) && equals < arg.length - 1) continue;
      return GIT_OUTPUT_RULE;
    }
    for (let k = 1; k < arg.length; k += 1) {
      const char = arg[k] as string;
      if (form.shortAttached.includes(char)) break;
      if (form.shortValued.includes(char)) {
        if (k === arg.length - 1) i += 1;
        break;
      }
      if (!form.shortFlags.includes(char)) return GIT_OUTPUT_RULE;
    }
  }
  return null;
}

function checkSegment({ words, expands }: Segment, preamble: boolean, call: Extract<NormalizedToolCall, { kind: 'shell' }>, policy: HookPolicy, canon: Canon, seen: LineSeen): string | null {
  const { commands } = policy;
  if (words[0] === 'gsd_run') {
    if (!preamble) return 'shell-gsd-no-preamble';
    const args = words.slice(1);
    const verb = commands.gsdReadVerbs
      .filter((entry) => startsWithWords(args, splitWords(entry)))
      .sort((a, b) => splitWords(b).length - splitWords(a).length)[0];
    if (verb === undefined) return 'shell-gsd-verb';
    // Fail closed as for the read-only commands (MF-04): an expanding word is a path set the checks below cannot name.
    if (expands) return 'shell-syntax';
    return checkGsdArgs(verb, args.slice(splitWords(verb).length), shellCwd(call, policy), policy, canon);
  }
  // A contract command is judged before the denied prefixes: the scope drops `npm` and `npx` from them only for a listed form, so any
  // other form of either still falls through to shell-not-allowed below.
  const agent = matchAgentCommand(words, expands, call, policy, canon);
  if (agent === null) {
    seen.agentCommand = true;
    return null;
  }
  if (agent !== undefined) return agent;
  if (commands.deniedPrefixes.some((prefix) => startsWithWords(words, splitWords(prefix)))) return 'shell-denied-prefix';
  const entry = commands.readOnly.map(splitWords).find((tokens) => startsWithWords(words, tokens));
  if (entry === undefined) return 'shell-not-allowed';
  // Fail closed (MF-04): a word the shell would expand is a path set the check below cannot name.
  if (expands) return 'shell-syntax';
  const args = words.slice(entry.length);
  if (words[0] === 'find' && args.some((arg) => FIND_DENIED_ACTIONS.includes(arg))) return 'shell-find-action';
  if (words[0] === 'git' && args.some((arg) => GIT_DENIED_OPTIONS.some((option) => arg === option || arg.startsWith(`${option}=`)))) return 'shell-git-option';
  // Every operand and every option value (attached, or the next word) may name a file; each gets the same read check as the
  // Read tool. A word like `-f/home/u/.netrc` or one after a bare `--` is judged as a path, never skipped as an option.
  const parsed = parseReadArgs(entry.join(' '), args);
  if (parsed.malformed) return 'shell-option-value';
  const cwd = shellCwd(call, policy);
  const named = checkRead([...parsed.positional, ...parsed.values].map((arg) => absolutize(cwd, arg)), policy, canon);
  if (named !== null) return named;
  if (words[0] !== 'git') return null;
  return checkGitObjects(parsed.positional, call, policy, canon) ?? checkGitOutput(entry.join(' '), args, parsed.positional);
}

function checkLine(line: string, preamble: boolean, call: Extract<NormalizedToolCall, { kind: 'shell' }>, policy: HookPolicy, canon: Canon, seen: LineSeen): string | null {
  if (preamble && line === GSD_INIT_FILE_LINE) return null;
  let text = line;
  let substituted = false;
  const assignment = /^[A-Za-z_][A-Za-z0-9_]*=\$\((.*)\)$/.exec(line);
  if (assignment !== null) {
    // VAR=$(gsd_run verb ...): the substitution may hold nothing but a GSD read verb.
    if (!preamble) return 'shell-gsd-no-preamble';
    text = (assignment[1] as string).trim();
    substituted = true;
  }
  const segments = lex(text);
  if (segments === null) return 'shell-syntax';
  if (substituted && (segments.length !== 1 || (segments[0] as Segment).words[0] !== 'gsd_run')) return 'shell-syntax';
  for (const segment of segments) {
    const rule = checkSegment(segment, preamble, call, policy, canon, seen);
    if (rule !== null) return rule;
  }
  return null;
}

function decideShell(call: Extract<NormalizedToolCall, { kind: 'shell' }>, policy: HookPolicy, canon: Canon): HookDecision {
  // No shell at all (the knowledge pass): nothing is read-only enough, and a GSD verb is not admitted either.
  if (policy.commands.strategy === 'none') return deny('shell-disabled');
  const command = call.command.trim();
  if (command === '' || command.length > MAX_COMMAND_CHARS) return deny('shell-syntax');

  let lines: string[] = [command];
  let preamble = false;
  const { preambleSha256: sha, preambleLength: length } = policy.commands;
  if (sha !== undefined && length !== undefined) {
    const bytes = new TextEncoder().encode(command);
    if (bytes.length >= length && sha256Hex(bytes.subarray(0, length)) === sha) {
      const rest = new TextDecoder().decode(bytes.subarray(length));
      if (rest !== '' && !rest.startsWith('\n')) return deny('shell-preamble-trailing');
      preamble = true;
      lines = rest.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
    }
  }
  const seen: LineSeen = { agentCommand: false };
  for (const line of lines) {
    const rule = checkLine(line, preamble, call, policy, canon, seen);
    if (rule !== null) return deny(rule);
  }
  return { decision: 'allow', rule: seen.agentCommand ? 'agent-command' : 'shell-identity', budget: 'toolCalls', ...(policy.commands.strategy === 'hook-allow' ? { explicit: true } : {}) };
}

// ---------------------------------------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------------------------------------

const toolNameOf = (call: NormalizedToolCall): string | undefined => ('tool' in call ? call.tool : undefined);

export function decideToolCall(call: NormalizedToolCall, policy: HookPolicy, canon: Canon): HookDecision {
  // The run purpose names tools a human would have to answer (AskUserQuestion): refused by name, so no unattended run waits on one (RC-4).
  const tool = toolNameOf(call);
  if (tool !== undefined && policy.deniedTools?.includes(tool)) return deny('no-human-prompts');
  switch (call.kind) {
    case 'file-write': {
      const rule = checkWrite(call.paths, policy, canon);
      return rule !== null ? deny(rule) : { decision: 'allow', rule: 'write-set', budget: 'toolCalls' };
    }
    case 'file-read': {
      const rule = checkRead(call.paths, policy, canon);
      return rule !== null ? deny(rule) : { decision: 'allow', rule: 'read-set', budget: 'toolCalls' };
    }
    case 'search': {
      const rule = checkRead(call.patternRoot === undefined ? [call.path] : [call.path, call.patternRoot], policy, canon);
      return rule !== null ? deny(rule) : { decision: 'allow', rule: 'read-set', budget: 'toolCalls' };
    }
    case 'shell':
      // A background shell runs unseen past the end of the call; the run purpose refuses it (CS-6).
      if (call.background && policy.denyBackgroundShell === true) return deny('background-shell');
      return decideShell(call, policy, canon);
    case 'subagent':
      return policy.subagentTypes.includes(call.subagentType ?? GENERAL_PURPOSE)
        ? { decision: 'allow', rule: 'subagent-type', budget: 'subagentsTotal' }
        : deny('subagent-type');
    case 'web':
      return deny('network-tool');
    case 'meta':
      return { decision: 'allow', rule: 'meta', budget: 'toolCalls' };
    case 'other':
      return deny('unknown-tool');
  }
}

// ---------------------------------------------------------------------------------------------------------
// Read before edit and loop limits (plan 02-11)
// ---------------------------------------------------------------------------------------------------------

export const EDIT_WITHOUT_READ_RULE = 'edit-without-read';
export const FILE_CHANGED_SINCE_READ_RULE = 'file-changed-since-read';
export const INEFFECTIVE_SEARCH_RULE = 'ineffective-search';

export interface ReadBeforeEditInput {
  tool: string;
  // Whether the target is an existing regular file now.
  exists: boolean;
  // The digest this agent recorded for the path in this invocation, if any, and the digest the hook computed from the file now.
  recorded: string | undefined;
  current: string | undefined;
  // The clone-relative path, for the corrective message; the caller supplies it because this module reads no file and knows no root.
  displayPath?: string;
}

const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'MultiEdit', 'NotebookEdit']);

// CON-7: an edit of a file needs a read of it by the same agent in this invocation, and the file must be as it was when read. A Write of
// a path that does not exist yet creates a file and needs no read; a Write over an existing file is an edit. The digests come in as
// arguments: this function reads no file. Null is no objection.
export function decideReadBeforeEdit(input: ReadBeforeEditInput): HookDecision | null {
  if (!EDIT_TOOLS.has(input.tool) && !(input.tool === 'Write' && input.exists)) return null;
  const again = `read ${input.displayPath ?? 'the file'} again before editing it`;
  if (input.recorded === undefined) return { decision: 'deny', rule: EDIT_WITHOUT_READ_RULE, reason: again };
  if (!input.exists || input.current !== input.recorded) return { decision: 'deny', rule: FILE_CHANGED_SINCE_READ_RULE, reason: again };
  return null;
}

export interface LoopCounts {
  // Consecutive hook denials in the invocation, the call being decided included when it is denied.
  consecutiveDenials?: number;
  // Consecutive Grep or Glob decisions before the call being decided (a search); absent for any other call.
  consecutiveSearches?: number;
}

export interface LoopStop {
  stop: true;
  reason: 'consecutive-denials' | 'ineffective-search';
  count: number;
}

const isCount = (n: number | undefined): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

// CON-14: whether the counts reach a limit. A limit of zero leaves that control off. Searches are judged first: the call is itself
// refused `ineffective-search`, and the caller then counts that refusal as a denial.
export function loopLimitOf(counts: LoopCounts, limits: LoopLimits): LoopStop | null {
  const searches = counts.consecutiveSearches;
  if (limits.consecutiveSearches > 0 && isCount(searches) && searches >= limits.consecutiveSearches) return { stop: true, reason: 'ineffective-search', count: searches };
  const denials = counts.consecutiveDenials;
  if (limits.consecutiveDenials > 0 && isCount(denials) && denials >= limits.consecutiveDenials) return { stop: true, reason: 'consecutive-denials', count: denials };
  return null;
}
