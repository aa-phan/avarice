// Privileged shell forms (plan 04-19; FR-12, FR-14, ADR-005, T-04-50, T-04-53). A shell command that leaves the machine or changes a shared system (a push, a
// pull request, a release, a write through the SCM API, a package publish) is named here by the action of the action table (src/domain/action-class.ts), so the
// hook can refuse it with the rule `privileged:<action>` and offer the approval route instead of the bare prefix rule. Pure: it reads text and returns a name and
// the parameters an approval binds. The hook entry, the run decision and the attended mode all ask this one module.
//
// What it recognizes is the command word and its arguments as the shell would split them: a leading NAME=value assignment, `env`, `command`, `exec`, `nohup`,
// `nice`, `sudo` and `time` in front of the program, the program's directory (`/usr/bin/git`) and case, git's global options (`-C dir`, `-c name=value`,
// `--git-dir`), a segment after `;`, `&&`, `||`, `|`, a newline, a parenthesis or a backtick, and a command substitution, also inside double quotes. It does not
// run or expand anything: a name the shell builds from a variable, an alias, a script that pushes, `bash -c` over a computed string and a function are the
// documented bypass of command classification (ADR-005, the SEC-6 enforcement map). The sandbox (no network, no credentials) and the SCM platform's own
// protections are the controls that hold when this one is evaded.
//
// The parameters are what an approval is bound to (src/domain/approval.ts): the target of the effect (remote and refspec, base and head, tag, endpoint and method)
// and the NAMES of the options given (`--force`, `--title`), never an option's value, so a title or a body is not bound and `--force` is.
export interface PrivilegedCommand {
  action: string;
  params: Record<string, string>;
}

// One recognized form: a program, the words that follow it (after its global options), and the action it is. `gh api` is privileged only for a method that is
// not GET, which the parser decides.
export interface CommandForm {
  program: 'git' | 'gh' | 'npm';
  words: readonly string[];
  action: string;
}

export const PRIVILEGED_COMMAND_FORMS: readonly CommandForm[] = Object.freeze([
  { program: 'git', words: ['push'], action: 'git.push' },
  { program: 'gh', words: ['pr', 'create'], action: 'scm.pr.create' },
  { program: 'gh', words: ['pr', 'merge'], action: 'scm.pr.merge' },
  { program: 'gh', words: ['pr', 'edit'], action: 'scm.pr.update' },
  { program: 'gh', words: ['release', 'create'], action: 'release.publish' },
  { program: 'gh', words: ['api'], action: 'scm.api.write' },
  { program: 'npm', words: ['publish'], action: 'release.publish' },
]);

const formOf = (program: CommandForm['program'], words: readonly string[]): CommandForm | undefined =>
  PRIVILEGED_COMMAND_FORMS.find((form) => form.program === program && form.words.length === words.length && form.words.every((w, i) => words[i] === w));

// ---------------------------------------------------------------------------------------------------------
// Splitting a command line into the commands it holds
// ---------------------------------------------------------------------------------------------------------

const MAX_COMMAND_CHARS = 65_536;
const MAX_NESTING = 8;

// The index of the `)` that closes a `$(` opened just before `from`, or the end of the text for one that never closes. Single-quoted spans are skipped.
function closingParen(text: string, from: number): number {
  let depth = 1;
  for (let i = from; i < text.length; i += 1) {
    const c = text[i] as string;
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end === -1) return text.length;
      i = end;
    } else if (c === '\\') {
      i += 1;
    } else if (c === '(') {
      depth += 1;
    } else if (c === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length;
}

function closingBacktick(text: string, from: number): number {
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === '\\') i += 1;
    else if (text[i] === '`') return i;
  }
  return text.length;
}

const isSpace = (c: string): boolean => c === ' ' || c === '\t';
const SEPARATORS = ';&|\n\r()';

// Every command of the line as its words, the commands inside substitutions included. Quotes are removed, a backslash makes the next character literal, a
// redirection and its target are dropped. The text is not expanded: `$x` is a word.
function splitInto(text: string, out: string[][], depth: number, failure: { reason?: string }): void {
  if (depth > MAX_NESTING) {
    failure.reason ??= `more than ${MAX_NESTING} nested command substitutions`;
    return;
  }
  let words: string[] = [];
  let word = '';
  let inWord = false;
  const flush = (): void => {
    if (inWord) words.push(word);
    word = '';
    inWord = false;
  };
  const endCommand = (): void => {
    flush();
    if (words.length > 0) out.push(words);
    words = [];
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    if (c === '\\') {
      const next = text[i + 1];
      if (next === undefined) break;
      if (next !== '\n') {
        word += next;
        inWord = true;
      }
      i += 2;
    } else if (c === "'") {
      const end = text.indexOf("'", i + 1);
      word += text.slice(i + 1, end === -1 ? text.length : end);
      inWord = true;
      i = end === -1 ? text.length : end + 1;
    } else if (c === '"') {
      inWord = true;
      i += 1;
      while (i < text.length && text[i] !== '"') {
        const d = text[i] as string;
        if (d === '\\') {
          word += text[i + 1] ?? '';
          i += 2;
        } else if (d === '$' && text[i + 1] === '(') {
          const end = closingParen(text, i + 2);
          splitInto(text.slice(i + 2, end), out, depth + 1, failure);
          i = end + 1;
        } else if (d === '`') {
          const end = closingBacktick(text, i + 1);
          splitInto(text.slice(i + 1, end), out, depth + 1, failure);
          i = end + 1;
        } else {
          word += d;
          i += 1;
        }
      }
      i += 1;
    } else if (c === '$' && text[i + 1] === '(') {
      const end = closingParen(text, i + 2);
      splitInto(text.slice(i + 2, end), out, depth + 1, failure);
      word += '$';
      inWord = true;
      i = end + 1;
    } else if (c === '`') {
      const end = closingBacktick(text, i + 1);
      splitInto(text.slice(i + 1, end), out, depth + 1, failure);
      inWord = true;
      i = end + 1;
    } else if (isSpace(c)) {
      flush();
      i += 1;
    } else if (SEPARATORS.includes(c)) {
      endCommand();
      i += 1;
    } else if (c === '<' || c === '>') {
      // A redirection: the file descriptor before it, the operator and its target are no words of the command.
      if (inWord && /^[0-9]+$/.test(word)) {
        word = '';
        inWord = false;
      } else {
        flush();
      }
      while (i < text.length && '<>&|'.includes(text[i] as string)) i += 1;
      while (i < text.length && isSpace(text[i] as string)) i += 1;
      while (i < text.length && !isSpace(text[i] as string) && !SEPARATORS.includes(text[i] as string)) i += 1;
    } else {
      word += c;
      inWord = true;
      i += 1;
    }
  }
  endCommand();
}

// The commands of a shell line, each as its words, or the reason the line could not be read. A line past a limit is never an empty list of commands.
export type Commands = { ok: true; commands: string[][] } | { ok: false; reason: string };

export function commandsOf(command: string): Commands {
  if (command.length > MAX_COMMAND_CHARS) return { ok: false, reason: `the command is longer than ${MAX_COMMAND_CHARS.toLocaleString('en-US')} characters` };
  const out: string[][] = [];
  const failure: { reason?: string } = {};
  splitInto(command, out, 0, failure);
  return failure.reason === undefined ? { ok: true, commands: out } : { ok: false, reason: failure.reason };
}

// ---------------------------------------------------------------------------------------------------------
// Finding the program
// ---------------------------------------------------------------------------------------------------------

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
// A word that begins a command in a compound statement and is not the command: the program is the word after it.
const RESERVED_WORDS: ReadonlySet<string> = new Set(['!', '{', '}', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', 'time']);
// Programs that run the command that follows them, and the options of each that take a separate value.
const WRAPPERS: Readonly<Record<string, readonly string[]>> = {
  env: ['-u', '--unset', '-C', '--chdir', '-P'],
  command: [],
  exec: ['-a'],
  nohup: [],
  builtin: [],
  nice: ['-n', '--adjustment'],
  sudo: ['-u', '-g', '-h', '-p', '-C', '-D', '-R', '-T', '-U', '--user', '--group', '--host', '--prompt', '--chdir', '--chroot'],
};

const baseOf = (word: string): string => (word.split('/').pop() ?? '').toLowerCase();

// The command's words with what comes before the program removed: assignments, reserved words and wrappers with their options. Null when the command
// runs nothing (`command -v git` only looks the program up).
function programWords(words: readonly string[]): string[] | null {
  let rest = [...words];
  for (let guard = 0; guard < 16; guard += 1) {
    const first = rest[0];
    if (first === undefined) return rest;
    if (ASSIGNMENT.test(first) || RESERVED_WORDS.has(first)) {
      rest = rest.slice(1);
      continue;
    }
    const wrapper = baseOf(first);
    const valued = WRAPPERS[wrapper];
    if (valued === undefined) return rest;
    let i = 1;
    for (; i < rest.length; i += 1) {
      const arg = rest[i] as string;
      if (arg === '--') {
        i += 1;
        break;
      }
      if (!arg.startsWith('-') || arg === '-') break;
      if (wrapper === 'command' && (arg === '-v' || arg === '-V')) return null;
      if (wrapper === 'env' && (arg === '-S' || arg === '--split-string')) {
        const value = rest[i + 1] ?? '';
        rest = [...rest.slice(0, i), ...value.split(/\s+/).filter((w) => w !== ''), ...rest.slice(i + 2)];
        i -= 1;
        continue;
      }
      if (wrapper === 'env' && arg.startsWith('--split-string=')) {
        rest = [...rest.slice(0, i), ...arg.slice('--split-string='.length).split(/\s+/).filter((w) => w !== ''), ...rest.slice(i + 1)];
        i -= 1;
        continue;
      }
      if (valued.includes(arg)) i += 1;
    }
    rest = rest.slice(i);
  }
  return rest;
}

// ---------------------------------------------------------------------------------------------------------
// Parsing the arguments of a form
// ---------------------------------------------------------------------------------------------------------

interface ArgSpec {
  // Options that take a value, by name. The value is bound as the named parameter, or taken and left out (null): a title or a body is not what an approval is for.
  valued: Readonly<Record<string, string | null>>;
  // The parameters the positional words are bound to, in order. A name ending in `*` takes every remaining word, joined by a space.
  positional: readonly string[];
}

interface Parsed {
  values: Record<string, string>;
  positionals: string[];
  // The names of the options given, valued or not, except those bound as a parameter.
  flags: Set<string>;
  // Every option name given, bound or not.
  seen: Set<string>;
}

function parseArgs(args: readonly string[], spec: ArgSpec): Parsed {
  const parsed: Parsed = { values: {}, positionals: [], flags: new Set(), seen: new Set() };
  const take = (name: string, value: string | undefined): void => {
    parsed.seen.add(name);
    const key = spec.valued[name];
    if (typeof key === 'string') {
      if (value !== undefined) parsed.values[key] = value;
    } else {
      parsed.flags.add(name);
    }
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg === '--') {
      parsed.positionals.push(...args.slice(i + 1));
      break;
    }
    if (arg === '-' || !arg.startsWith('-')) {
      parsed.positionals.push(arg);
    } else if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) take(arg.slice(0, eq), arg.slice(eq + 1));
      else if (Object.hasOwn(spec.valued, arg)) take(arg, args[(i += 1)]);
      else take(arg, undefined);
    } else if (Object.hasOwn(spec.valued, arg)) {
      take(arg, args[(i += 1)]);
    } else if (arg.length > 2 && Object.hasOwn(spec.valued, arg.slice(0, 2))) {
      take(arg.slice(0, 2), arg.slice(2));
    } else {
      take(arg, undefined);
    }
  }
  return parsed;
}

function paramsOf(parsed: Parsed, spec: ArgSpec): Record<string, string> {
  const params: Record<string, string> = { ...parsed.values };
  spec.positional.forEach((name, index) => {
    if (name.endsWith('*')) {
      const rest = parsed.positionals.slice(index);
      if (rest.length > 0) params[name.slice(0, -1)] = rest.join(' ');
    } else if (parsed.positionals[index] !== undefined) {
      params[name] = parsed.positionals[index] as string;
    }
  });
  if (parsed.flags.size > 0) params['options'] = [...parsed.flags].sort().join(' ');
  return params;
}

const GIT_PUSH: ArgSpec = {
  valued: { '-o': null, '--push-option': null, '--repo': 'repo', '--receive-pack': null, '--exec': null },
  positional: ['remote', 'refspec*'],
};

// The git options that come before the subcommand and take a separate value.
const GIT_VALUED_GLOBALS: readonly string[] = ['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--attr-source'];

const GH_FORMS: Readonly<Record<string, ArgSpec>> = {
  'pr create': {
    valued: { '--base': 'base', '-B': 'base', '--head': 'head', '-H': 'head', '--repo': 'repo', '-R': 'repo', '--title': null, '-t': null, '--body': null, '-b': null, '--body-file': null, '-F': null, '--assignee': null, '-a': null, '--label': null, '-l': null, '--milestone': null, '-m': null, '--project': null, '-p': null, '--reviewer': null, '-r': null, '--template': null, '-T': null },
    positional: ['operands*'],
  },
  'pr merge': {
    valued: { '--repo': 'repo', '-R': 'repo', '--subject': null, '-t': null, '--body': null, '-b': null, '--body-file': null, '-F': null, '--match-head-commit': 'matchHeadCommit' },
    positional: ['selector', 'operands*'],
  },
  'pr edit': {
    valued: { '--base': 'base', '-B': 'base', '--repo': 'repo', '-R': 'repo', '--title': null, '-t': null, '--body': null, '-b': null, '--body-file': null, '-F': null, '--add-assignee': null, '--add-label': null, '--add-project': null, '--add-reviewer': null, '--remove-assignee': null, '--remove-label': null, '--remove-project': null, '--remove-reviewer': null, '--milestone': null, '-m': null },
    positional: ['selector', 'operands*'],
  },
  'release create': {
    valued: { '--repo': 'repo', '-R': 'repo', '--target': 'target', '--title': null, '-t': null, '--notes': null, '-n': null, '--notes-file': null, '-F': null, '--notes-start-tag': null, '--discussion-category': null },
    positional: ['tag', 'assets*'],
  },
  api: {
    valued: { '--method': 'method', '-X': 'method', '--hostname': 'hostname', '--field': null, '-F': null, '--raw-field': null, '-f': null, '--header': null, '-H': null, '--input': null, '--jq': null, '-q': null, '--template': null, '-t': null, '--cache': null, '--preview': null, '-p': null },
    positional: ['endpoint', 'operands*'],
  },
};
// The options with which `gh api` sends a body or fields: it makes a request that names no method a POST (gh api --help).
const GH_API_FIELD_OPTIONS: readonly string[] = ['-f', '-F', '--field', '--raw-field', '--input'];

const NPM_PUBLISH: ArgSpec = {
  valued: { '--registry': 'registry', '--tag': 'tag', '--access': 'access', '--otp': null, '--prefix': null, '-C': null, '--workspace': null, '-w': null, '--userconfig': null, '--globalconfig': null, '--cache': null, '--loglevel': null },
  positional: ['subcommand', 'package', 'operands*'],
};

function classifyGit(args: readonly string[]): PrivilegedCommand | null {
  let i = 0;
  for (; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (!arg.startsWith('-') || arg === '-') break;
    if (GIT_VALUED_GLOBALS.includes(arg)) i += 1;
  }
  if (args[i] !== 'push') return null;
  const form = formOf('git', ['push']) as CommandForm;
  return { action: form.action, params: paramsOf(parseArgs(args.slice(i + 1), GIT_PUSH), GIT_PUSH) };
}

function classifyGh(args: readonly string[]): PrivilegedCommand | null {
  const key = args[0] === 'api' ? 'api' : `${args[0] ?? ''} ${args[1] ?? ''}`;
  const spec = GH_FORMS[key];
  const form = formOf('gh', key.split(' '));
  if (spec === undefined || form === undefined) return null;
  const parsed = parseArgs(args.slice(key === 'api' ? 1 : 2), spec);
  if (form.action === 'scm.api.write') {
    const given = parsed.values['method']?.toUpperCase();
    const method = given ?? (GH_API_FIELD_OPTIONS.some((option) => parsed.seen.has(option)) ? 'POST' : 'GET');
    if (method === 'GET') return null;
    parsed.values['method'] = method;
  }
  return { action: form.action, params: paramsOf(parsed, spec) };
}

function classifyNpm(args: readonly string[]): PrivilegedCommand | null {
  const parsed = parseArgs(args, NPM_PUBLISH);
  if (parsed.positionals[0] !== 'publish') return null;
  const form = formOf('npm', ['publish']) as CommandForm;
  // `subcommand` is the word `publish` itself: it is not a parameter.
  const params = paramsOf(parsed, NPM_PUBLISH);
  delete params['subcommand'];
  return { action: form.action, params };
}

// The privileged action one command is, or null. `words` are the words of a single command (no `;`, `&&` or `|`).
export function classifyShellCommand(words: readonly string[]): PrivilegedCommand | null {
  const program = programWords(words);
  if (program === null || program.length === 0) return null;
  const args = program.slice(1);
  switch (baseOf(program[0] as string)) {
    case 'git':
      return classifyGit(args);
    case 'gh':
      return classifyGh(args);
    case 'npm':
      return classifyNpm(args);
    default:
      return null;
  }
}

// The three answers about a shell line (plan 04-40; CR-01): nothing privileged, the privileged commands it holds, or a line the classifier could not read.
export type LineClassification =
  | { kind: 'none' }
  | { kind: 'privileged'; commands: PrivilegedCommand[] }
  | { kind: 'unparseable'; reason: string };

export const UNPARSEABLE_RULE = 'privileged:unparseable';

// Every privileged command a shell line holds, in scan order, so `cd x && git push` and `echo $(git push)` are named too. A line the classifier could not read is
// 'unparseable', never 'none': both callers refuse it.
export function classifyLine(command: string): LineClassification {
  const split = commandsOf(command);
  if (!split.ok) return { kind: 'unparseable', reason: split.reason };
  const commands: PrivilegedCommand[] = [];
  for (const words of split.commands) {
    const found = classifyShellCommand(words);
    if (found !== null) commands.push(found);
  }
  return commands.length === 0 ? { kind: 'none' } : { kind: 'privileged', commands };
}

// The reason the model is told with a refusal of a privileged form: the action, and the command the owner runs to approve it.
export function privilegedReason(action: string, requestId: string): string {
  return `${action} needs an approval for these parameters; the owner approves it at a terminal with: avarice approve ${requestId}`;
}
