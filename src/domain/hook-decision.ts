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
import { matchesAny } from './glob.ts';
import { sha256Hex } from './digest.ts';
import { FIND_DENIED_ACTIONS } from './invocation-scope.ts';
import type { BashStrategy, InvocationPurpose } from './invocation-scope.ts';

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
}

export interface HookDecision {
  decision: 'allow' | 'deny';
  rule: string;
  // The budget one allowed call charges.
  budget?: 'toolCalls' | 'subagentsTotal';
  // The hook prints an allow (hook-allow strategy); otherwise an allow is silent.
  explicit?: boolean;
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
const PURPOSES: readonly string[] = ['map', 'intel', 'knowledge'];

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

function checkWrite(paths: readonly string[], policy: HookPolicy, canon: Canon): string | null {
  for (const path of paths) {
    const canonical = canon(path);
    if (canonical === null) return 'unresolvable-path';
    if (!policy.writeRoots.some((root) => under(canonical, root))) return 'outside-write-set';
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
// An entry that is not listed takes none. `-fPATH` and `-f PATH` both name PATH as a value.
export const SHORT_VALUE_OPTIONS: Readonly<Record<string, string>> = {
  grep: 'ABCDdefm',
  head: 'nc',
  tail: 'bnc',
  'git log': 'nSGOLUMCBl',
  'git show': 'nSGOLUMCBl',
  'git ls-files': 'xX',
  'git status': 'uM',
};

// Long options that take a required value, per read-only command entry (same key as SHORT_VALUE_OPTIONS), matched by exact
// name only: a prefix could resolve to a different option in another grep, which would hide a walk root. A listed option
// consumes its next word whatever that word looks like, the way getopt consumes a required argument (WR-01). The list holds
// options GNU grep gives a required argument and that /usr/bin/grep either consumes or rejects (a grep that rejects an option
// exits before walking, so consuming its word hides no root). `--context` and `--color`/`--colour` are left out: their
// argument is optional in at least one grep (BSD `--context` leaves its separate word in place), so they stay unmodelled.
export const LONG_VALUE_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  grep: [
    '--after-context',
    '--before-context',
    '--binary-files',
    '--devices',
    '--directories',
    '--exclude',
    '--exclude-dir',
    '--exclude-from',
    '--file',
    '--group-separator',
    '--include',
    '--include-dir',
    '--label',
    '--max-count',
    '--regexp',
  ],
};

// What the words after a read command's name say. The parser treats every operand and every attached or separate option
// value as a path candidate (fail closed: a non-path value such as a search pattern starting with `/` is judged as a path).
interface ReadArgs {
  // Words that are not options (and every word after a bare `--`): the paths, or for grep the pattern and the paths.
  positional: string[];
  // Option values: the rest of a short cluster after a value letter, the next word when the letter ends the cluster, and `--name=value`.
  values: string[];
  flags: Set<string>;
  shortValues: Array<{ flag: string; value: string }>;
  longs: Array<{ name: string; value: string | null }>;
  // A character in a short cluster that is not an ASCII letter or digit and that no value-taking letter consumed.
  malformed: boolean;
  // WR-01: a long option that is not in LONG_VALUE_OPTIONS (and does not name a recursion option) is followed by another
  // argument, so the hook cannot prove whether that word is its value or an operand.
  unprovenLong: boolean;
}

const isAsciiAlphanumeric = (char: string): boolean => /^[A-Za-z0-9]$/.test(char);

function parseReadArgs(entryKey: string, args: readonly string[]): ReadArgs {
  const valueLetters = SHORT_VALUE_OPTIONS[entryKey] ?? '';
  const longValueOptions = LONG_VALUE_OPTIONS[entryKey] ?? [];
  const parsed: ReadArgs = { positional: [], values: [], flags: new Set(), shortValues: [], longs: [], malformed: false, unprovenLong: false };
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
      const name = equals === -1 ? arg : arg.slice(0, equals);
      let value = equals === -1 ? null : arg.slice(equals + 1);
      if (value === null && longValueOptions.includes(name) && args[i + 1] !== undefined) {
        value = args[i + 1] as string;
        i += 1;
      } else if (value === null && i + 1 < args.length && !longValueOptions.includes(name) && !isLongOption(name, '--recursive', 5) && !isLongOption(name, '--dereference-recursive', 5)) {
        parsed.unprovenLong = true;
      }
      parsed.longs.push({ name, value });
      if (value !== null && value !== '') parsed.values.push(value);
    } else if (!/^-[0-9]+$/.test(arg)) {
      // A cluster, read per character (`-rnf/path` is r, n and the value of f).
      for (let k = 1; k < arg.length; k += 1) {
        const char = arg[k] as string;
        if (!isAsciiAlphanumeric(char)) {
          parsed.malformed = true;
          break;
        }
        if (!valueLetters.includes(char)) {
          parsed.flags.add(char);
          continue;
        }
        const attached = arg.slice(k + 1);
        const value = attached !== '' ? attached : args[i + 1];
        if (attached === '' && value !== undefined) i += 1;
        if (value !== undefined) {
          parsed.values.push(value);
          parsed.shortValues.push({ flag: char, value });
        }
        break;
      }
    }
  }
  return parsed;
}

// GNU getopt accepts an unambiguous prefix of a long option, so `--recurs` is `--recursive`.
const isLongOption = (name: string, full: string, minLength: number): boolean => name.length >= minLength && full.startsWith(name);

// True when a secret glob (repository-relative, matched below staging) can match some path below the directory whose
// staging-relative segments are `root` ([] is staging itself). Fail closed: a `**` or any wildcard segment agrees with anything.
function globMayMatchBelow(glob: string, root: readonly string[]): boolean {
  const segments = glob.split('/');
  for (let i = 0; i < Math.min(segments.length, root.length); i += 1) {
    const segment = segments[i] as string;
    if (segment.includes('**')) return true;
    if (!/[*?[{]/.test(segment) && segment !== root[i]) return false;
  }
  // Agreeing so far, the glob can match below the root only if it names something deeper than the root itself.
  return segments.length > root.length;
}

// Why a recursive grep may not run, or null. The hook cannot list what the walk reaches, so it judges the directories the
// walk starts from: following links can leave every root, a root that contains a denied root reaches it, and below staging a
// secret glob may match a file the walk reads.
function recursiveRule(parsed: ReadArgs, call: Extract<NormalizedToolCall, { kind: 'shell' }>, policy: HookPolicy, canon: Canon): string | null {
  const { flags, longs, shortValues, positional } = parsed;
  const longNamed = (full: string, minLength: number): Array<{ name: string; value: string | null }> => longs.filter((l) => isLongOption(l.name, full, minLength));
  // CR-01 / P-3: classify every -d/--directories action fail closed. macOS BSD grep folds case (`RECURSE` recurses) and the
  // ugrep embedded in Claude Code accepts `dereference-recurse`, so only `read` and `skip` (any case) are non-recursive.
  // `recurse` walks; any other value, an abbreviation, or a long option that consumed no value follows links. Judge the
  // command as if any one action applies (a real grep uses the last one; refusing more is the fail-closed side).
  const directoriesActions: Array<string | null> = [
    ...shortValues.filter((v) => v.flag === 'd').map((v) => v.value),
    ...longNamed('--directories', 3).map((l) => l.value),
  ];
  let directoriesRecurse = false;
  let directoriesFollowLinks = false;
  for (const action of directoriesActions) {
    const value = action === null ? null : action.toLowerCase();
    if (value === 'read' || value === 'skip') continue;
    if (value === 'recurse') directoriesRecurse = true;
    else directoriesFollowLinks = true;
  }
  const dereferences = flags.has('R') || longNamed('--dereference-recursive', 5).length > 0 || directoriesFollowLinks;
  const recursive = flags.has('r') || dereferences || longNamed('--recursive', 5).length > 0 || directoriesRecurse;
  if (!recursive) return null;
  // `-S` and `-O` make BSD grep follow links while walking.
  if (dereferences || flags.has('S') || flags.has('O')) return 'shell-recursive-read';

  // The pattern is the first operand unless an option supplied it; the remaining operands are the walked roots.
  const patternFromOption =
    shortValues.some((v) => v.flag === 'e' || v.flag === 'f') || longs.some((l) => isLongOption(l.name, '--regexp', 4) || isLongOption(l.name, '--file', 4));
  const cwd = call.cwd.startsWith('/') ? call.cwd : policy.stagingPath;
  const walked = (patternFromOption ? positional : positional.slice(1)).map((path) => absolutize(cwd, path));
  // WR-01: when an unmodelled long option may have swallowed an operand, the operand list is unprovable. The computed roots
  // plus the working directory are a superset of every root the real grep can walk under any arity reading.
  if (walked.length === 0 || parsed.unprovenLong) walked.push(cwd);

  const staging = trimSlashes(policy.stagingPath);
  const denied = policy.denyRead.filter((root) => !policy.allowRead.some((allowed) => under(root, allowed)));
  for (const path of walked) {
    const root = canon(path);
    if (root === null) return 'unresolvable-path';
    const outside = readRule(root, policy);
    if (outside !== null) return outside;
    if (denied.some((deniedRoot) => under(deniedRoot, root))) return 'shell-recursive-read';
    if (under(root, staging)) {
      const relative = root === staging ? [] : root.slice(staging.length + 1).split('/');
      if (policy.denyReadGlobs.some((glob) => globMayMatchBelow(glob, relative))) return 'shell-recursive-read';
    }
  }
  return null;
}

function checkSegment({ words, expands }: Segment, preamble: boolean, call: Extract<NormalizedToolCall, { kind: 'shell' }>, policy: HookPolicy, canon: Canon): string | null {
  const { commands } = policy;
  if (words[0] === 'gsd_run') {
    if (!preamble) return 'shell-gsd-no-preamble';
    const args = words.slice(1);
    return commands.gsdReadVerbs.some((verb) => startsWithWords(args, splitWords(verb))) ? null : 'shell-gsd-verb';
  }
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
  const cwd = call.cwd.startsWith('/') ? call.cwd : policy.stagingPath;
  const named = checkRead([...parsed.positional, ...parsed.values].map((arg) => absolutize(cwd, arg)), policy, canon);
  if (named !== null) return named;
  return words[0] === 'grep' ? recursiveRule(parsed, call, policy, canon) : null;
}

function checkLine(line: string, preamble: boolean, call: Extract<NormalizedToolCall, { kind: 'shell' }>, policy: HookPolicy, canon: Canon): string | null {
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
    const rule = checkSegment(segment, preamble, call, policy, canon);
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
  for (const line of lines) {
    const rule = checkLine(line, preamble, call, policy, canon);
    if (rule !== null) return deny(rule);
  }
  return { decision: 'allow', rule: 'shell-identity', budget: 'toolCalls', ...(policy.commands.strategy === 'hook-allow' ? { explicit: true } : {}) };
}

// ---------------------------------------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------------------------------------

export function decideToolCall(call: NormalizedToolCall, policy: HookPolicy, canon: Canon): HookDecision {
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
