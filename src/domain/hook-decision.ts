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

// Why a canonical path may not be read, or null.
function readRule(canonical: string, policy: HookPolicy): string | null {
  // A purpose that reads only its corpus (the knowledge pass): anything else, even inside staging, is outside its read set.
  if (policy.readConfine !== undefined && !policy.readConfine.some((root) => under(canonical, root))) return 'outside-read-set';
  if (policy.denyRead.some((root) => under(canonical, root)) && !policy.allowRead.some((root) => under(canonical, root))) return 'deny-read';
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
  // Every word that is not an option may name a file; it gets the same read check as the Read tool.
  const cwd = call.cwd.startsWith('/') ? call.cwd : policy.stagingPath;
  return checkRead(args.filter((arg) => !arg.startsWith('-')).map((arg) => absolutize(cwd, arg)), policy, canon);
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
