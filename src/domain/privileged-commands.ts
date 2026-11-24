// Privileged shell forms (plan 04-19; FR-12, FR-14, ADR-005, T-04-50, T-04-53). A shell command that leaves the machine or changes a shared system (a push, a
// pull request, a release, a write through the SCM API, a package publish) is named here by the action of the action table (src/domain/action-class.ts), so the
// hook can refuse it with the rule `privileged:<action>` and offer the approval route instead of the bare prefix rule. Pure: it reads text and returns a name and
// the parameters an approval binds. The hook entry, the run decision and the attended mode all ask this one module.
//
// What it recognizes is the command word and its arguments as the shell would split them (plan 04-40): the quoting, comment, here-document and redirection rules of the
// shell, a leading NAME=value assignment, `env`, `command`, `exec`, `nohup`, `nice`, `sudo`, `time` (with `-p`), `timeout`, `xargs`, `setsid`, `stdbuf`, `ionice` and `flock` in front of the program, a shell started on a literal string (`bash -c 'git push'`, plan 04-51) and `eval`, the program's directory
// (`/usr/bin/git`) and case, git's global options (`-C dir`, `-c name=value`, `--git-dir`), gh's options between a group and its subcommand (`gh pr -R x/y create`, plan 04-57), a segment after `;`, `&&`, `||`, `|`, a newline, a parenthesis or a
// backtick, and a command substitution, a process substitution or a here-document body, also inside double quotes. A line it cannot read (longer than
// MAX_COMMAND_CHARS, nested deeper than MAX_NESTING, more than MAX_PREFIX_WORDS words before the program, or a quote or substitution left open) is `unparseable`,
// and both callers refuse it: no limit and no parse failure is read as "not privileged". It does not run or expand anything: a name the shell builds at run time (a
// variable, an alias, a function), a script that pushes, a shell started on a computed string (`bash -c` over a built string, text piped into a shell) and repository or shell
// state changed by an earlier separate call are the documented bypass of
// command classification (ADR-005, the SEC-6 enforcement map). The sandbox (no network, no credentials) and the SCM platform's own protections are the controls that
// hold when this one is evaded.
//
// The parameters are what an approval is bound to (src/domain/approval.ts): the target of the effect (remote and refspec, base and head, tag, endpoint and method)
// and the NAMES of the options given (`--force`, `--title`), never an option's value, so a title or a body is not bound and `--force` is. What redirects a command's
// effect from outside its own options is bound too (plan 04-51; CR-03, T-04-136): `gitOptions`, git's global options before the subcommand, verbatim with their values; `env`,
// the assignments before the program and the options and assignments of an `env` wrapper, verbatim and in order (every name, because HOME and XDG_CONFIG_HOME steer git and
// gh as GIT_ and GH_ names do); and `line`, `sha256:` and the first 32 hex digits of the SHA-256 of the exact command text, which binds everything else on the line (an earlier
// cd or git config, a wrapper's options, a gh api body) to the command the owner saw. What an approval still does not bind is the documented residual of the enforcement map:
// names built at run time, and repository or shell state changed by an earlier separate call.
import { sha256Hex } from './digest.ts';

export interface PrivilegedCommand {
  action: string;
  params: Record<string, string>;
  // Set when no approval can bind what the command does (plan 04-51; WR-04): the reason, in words the owner and the model are told.
  unapprovable?: string;
}

// The attended deny rule for a command that cannot be approved: it names no request, because there is nothing the owner could approve.
export const UNAPPROVABLE_RULE = 'privileged:unapprovable';

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
// Scanning a command line for the commands it holds
// ---------------------------------------------------------------------------------------------------------
//
// One recursive scanner reads the text once per nesting level, as the shell reads it (plan 04-40; CR-01, CR-02, WR-01, T-04-105, T-04-106). It follows the
// shell's own rules: single quotes are literal; double quotes honour a backslash before a quote, backslash, dollar or backtick and hold substitutions; `$'...'` is a word
// with backslash escapes; a backslash outside quotes makes the next character literal and a backslash-newline is removed; `#` at the start of a word starts a comment;
// `$(`, `$((`, backticks and `<(` `>(` are scanned by this same scanner, inside or outside double quotes, so a quoted `)` never ends a substitution; a redirection and
// its target are no words of the command, and a here-document body is read after the line that names it. A limit passed, or a quote, substitution or backtick left
// open outside a here-document body, ends the scan with a reason: such a line is unparseable, never "no commands".

const MAX_COMMAND_CHARS = 65_536;
const MAX_NESTING = 8;

type Terminator = 'top' | ')' | '`' | '\\`';

interface Scan {
  text: string;
  out: string[][];
  failure: string | undefined;
}

interface Pending {
  delimiter: string;
  stripTabs: boolean;
  quoted: boolean;
}

interface Word {
  text: string;
  started: boolean;
  quoted: boolean;
  pos: number;
}

const fail = (scan: Scan, reason: string): void => {
  scan.failure ??= reason;
};

// What ends a word outside quotes: a blank, a command separator, a parenthesis or a redirection.
const WORD_STOP = ' \t;&|\n\r()<>';

const ANSI_SIMPLE: Readonly<Record<string, string>> = { a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };

// The text of a `$'...'` word with its backslash escapes decoded, so `$'\x67it'` is the word git.
function decodeAnsiC(body: string): string {
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i] as string;
    const next = body[i + 1];
    if (ch !== '\\' || next === undefined) {
      out += ch;
    } else if (Object.hasOwn(ANSI_SIMPLE, next)) {
      out += ANSI_SIMPLE[next] ?? '';
      i += 1;
    } else if (next === 'x' && /^[0-9a-fA-F]{1,2}/.test(body.slice(i + 2, i + 4))) {
      const digits = (/^[0-9a-fA-F]{1,2}/.exec(body.slice(i + 2, i + 4)) as RegExpExecArray)[0];
      out += String.fromCharCode(parseInt(digits, 16));
      i += 1 + digits.length;
    } else if (next >= '0' && next <= '7') {
      const digits = (/^[0-7]{1,3}/.exec(body.slice(i + 1, i + 4)) as RegExpExecArray)[0];
      out += String.fromCharCode(parseInt(digits, 8) & 0xff);
      i += digits.length;
    } else if ((next === 'u' || next === 'U') && /^[0-9a-fA-F]{1,8}/.test(body.slice(i + 2, i + 10))) {
      const digits = (/^[0-9a-fA-F]{1,8}/.exec(body.slice(i + 2, i + (next === 'u' ? 6 : 10))) as RegExpExecArray)[0];
      const code = parseInt(digits, 16);
      out += code <= 0x10ffff ? String.fromCodePoint(code) : '';
      i += 1 + digits.length;
    } else {
      out += ch;
    }
  }
  return out;
}

// A substitution opened just before `pos`: the position after its terminator. An unterminated one is a failure outside a here-document body, and runs to the end inside one.
function scanSubstitution(scan: Scan, pos: number, end: number, depth: number, term: Terminator, tolerant: boolean): number {
  const next = scanCommands(scan, pos, end, depth + 1, term, tolerant);
  if (scan.failure !== undefined) return end;
  if (next >= 0) return next;
  if (!tolerant) fail(scan, term === ')' ? 'a command substitution is not closed' : 'a backquote is not closed');
  return end;
}

interface Quoted {
  text: string;
  pos: number;
  closed: boolean;
}

// The inside of a double-quoted string that opens just before `pos`.
function readDouble(scan: Scan, pos: number, end: number, depth: number, tolerant: boolean, term: Terminator): Quoted {
  const t = scan.text;
  let text = '';
  while (pos < end && scan.failure === undefined) {
    const ch = t[pos] as string;
    if (ch === '"') return { text, pos: pos + 1, closed: true };
    if (ch === '\\') {
      const next = pos + 1 < end ? t[pos + 1] : undefined;
      if (next === undefined) {
        text += '\\';
        pos += 1;
      } else if (next === '\n') {
        pos += 2;
      } else if (next === '"' || next === '\\' || next === '$' || next === '`') {
        text += next;
        pos += 2;
      } else {
        text += '\\';
        pos += 1;
      }
    } else if (ch === '$' && t[pos + 1] === '(' && pos + 1 < end) {
      pos = scanSubstitution(scan, pos + 2, end, depth, ')', tolerant);
      text += '$';
    } else if (ch === '`') {
      if (term === '`') break;
      pos = scanSubstitution(scan, pos + 1, end, depth, '`', tolerant);
      text += '$';
    } else {
      text += ch;
      pos += 1;
    }
  }
  return { text, pos, closed: false };
}

// One word: quotes removed, a backslash making the next character literal, substitutions scanned for commands (and standing for `$`). A process substitution at the start
// is a word of its own.
function readWord(scan: Scan, pos: number, end: number, depth: number, tolerant: boolean, term: Terminator): Word {
  const t = scan.text;
  if ((t[pos] === '<' || t[pos] === '>') && t[pos + 1] === '(') {
    const after = scanSubstitution(scan, pos + 2, end, depth, ')', tolerant);
    return { text: `${t[pos]}(`, started: true, quoted: false, pos: after };
  }
  let text = '';
  let started = false;
  let quoted = false;
  while (pos < end && scan.failure === undefined) {
    const ch = t[pos] as string;
    if (WORD_STOP.includes(ch)) break;
    if (ch === '\\') {
      const next = pos + 1 < end ? t[pos + 1] : undefined;
      if (term === '\\`' && next === '`') break;
      if (next === undefined) {
        text += '\\';
        started = true;
        pos += 1;
      } else if (next === '\n') {
        pos += 2;
      } else if (term === '`' && next === '`') {
        pos = scanSubstitution(scan, pos + 2, end, depth, '\\`', tolerant);
        text += '$';
        started = true;
      } else if (term === '\\`' && next === '\\' && t[pos + 2] === '`') {
        fail(scan, 'backquotes are nested more than two deep');
      } else {
        text += next;
        started = true;
        quoted = true;
        pos += 2;
      }
    } else if (ch === "'") {
      const close = t.indexOf("'", pos + 1);
      if (close === -1 || close >= end) {
        if (!tolerant) {
          fail(scan, 'a single quote is not closed');
          break;
        }
        text += "'";
        started = true;
        pos += 1;
      } else {
        text += t.slice(pos + 1, close);
        started = true;
        quoted = true;
        pos = close + 1;
      }
    } else if (ch === '"') {
      const inside = readDouble(scan, pos + 1, end, depth, tolerant, term);
      if (scan.failure !== undefined) break;
      if (inside.closed) {
        text += inside.text;
        started = true;
        quoted = true;
        pos = inside.pos;
      } else if (tolerant) {
        text += '"';
        started = true;
        pos += 1;
      } else {
        fail(scan, 'a double quote is not closed');
        break;
      }
    } else if (ch === '$') {
      const next = pos + 1 < end ? t[pos + 1] : undefined;
      if (next === "'") {
        let close = pos + 2;
        while (close < end && t[close] !== "'") close += t[close] === '\\' ? 2 : 1;
        if (close >= end) {
          if (!tolerant) {
            fail(scan, "a $'...' string is not closed");
            break;
          }
          text += '$';
          started = true;
          pos += 1;
        } else {
          text += decodeAnsiC(t.slice(pos + 2, close));
          started = true;
          quoted = true;
          pos = close + 1;
        }
      } else if (next === '"') {
        pos += 1;
      } else if (next === '(') {
        pos = scanSubstitution(scan, pos + 2, end, depth, ')', tolerant);
        text += '$';
        started = true;
      } else {
        text += '$';
        started = true;
        pos += 1;
      }
    } else if (ch === '`') {
      if (term === '`') break;
      pos = scanSubstitution(scan, pos + 1, end, depth, '`', tolerant);
      text += '$';
      started = true;
    } else {
      text += ch;
      started = true;
      pos += 1;
    }
  }
  return { text, started, quoted, pos };
}

// Text that a here-document without a quoted delimiter expands: only backslashes, `$(...)` and backticks matter; quotes are ordinary characters.
function scanExpansions(scan: Scan, pos: number, end: number, depth: number): void {
  const t = scan.text;
  while (pos < end && scan.failure === undefined) {
    const ch = t[pos] as string;
    if (ch === '\\') pos += 2;
    else if (ch === '$' && t[pos + 1] === '(' && pos + 1 < end) pos = scanSubstitution(scan, pos + 2, end, depth, ')', true);
    else if (ch === '`') pos = scanSubstitution(scan, pos + 1, end, depth, '`', true);
    else pos += 1;
  }
}

// The here-document bodies that begin after the newline just before `pos`, each running to the line that equals its delimiter or to `end`. A body is classified as commands,
// read tolerantly (it may be fed to an interpreter), and, when its delimiter is not quoted, also for the substitutions the shell would expand in it. Returns the position
// after the last delimiter line.
function readBodies(scan: Scan, pos: number, end: number, depth: number, pending: Pending[]): number {
  const t = scan.text;
  for (const here of pending) {
    const bodyStart = pos;
    let bodyEnd = end;
    while (pos < end) {
      const newline = t.indexOf('\n', pos);
      const lineEnd = newline === -1 || newline >= end ? end : newline;
      const line = t.slice(pos, lineEnd);
      const next = lineEnd < end ? lineEnd + 1 : end;
      if ((here.stripTabs ? line.replace(/^\t+/, '') : line) === here.delimiter) {
        bodyEnd = pos;
        pos = next;
        break;
      }
      pos = next;
    }
    scanCommands(scan, bodyStart, bodyEnd, depth + 1, 'top', true);
    if (!here.quoted) scanExpansions(scan, bodyStart, bodyEnd, depth + 1);
  }
  return pos;
}

const REDIRECTIONS: readonly string[] = ['<<<', '<<-', '<<', '<&', '<>', '<', '>>', '>&', '>|', '>', '&>>', '&>'];

// Commands of the text between `pos` and `end`, appended to scan.out. Returns the position after the terminator, or -1 when the text ended before it.
function scanCommands(scan: Scan, pos: number, end: number, depth: number, term: Terminator, tolerant: boolean): number {
  if (depth > MAX_NESTING) {
    fail(scan, `more than ${MAX_NESTING} nested command substitutions`);
    return end;
  }
  const t = scan.text;
  let words: string[] = [];
  let groups = 0;
  const pending: Pending[] = [];
  const endCommand = (): void => {
    if (words.length > 0) scan.out.push(words);
    words = [];
  };
  // A redirection operator at `pos` and its target, which is read as a word (substitutions in it are classified) and is no word of the command.
  const redirect = (at: number): number => {
    const operator = REDIRECTIONS.find((op) => t.startsWith(op, at)) as string;
    let p = at + operator.length;
    while (p < end && (t[p] === ' ' || t[p] === '\t')) p += 1;
    if (p >= end || ';&|\n\r()'.includes(t[p] as string)) return p;
    const target = readWord(scan, p, end, depth, tolerant, term);
    if (operator === '<<' || operator === '<<-') pending.push({ delimiter: target.text, stripTabs: operator === '<<-', quoted: target.quoted });
    return Math.max(target.pos, p + 1);
  };
  while (pos < end && scan.failure === undefined) {
    const ch = t[pos] as string;
    if (ch === ' ' || ch === '\t') {
      pos += 1;
    } else if (term === '\\`' && ch === '\\' && t[pos + 1] === '`') {
      endCommand();
      return pos + 2;
    } else if (term === '`' && ch === '`') {
      endCommand();
      return pos + 1;
    } else if (ch === '\\' && t[pos + 1] === '\n') {
      pos += 2;
    } else if (ch === '#') {
      while (pos < end && t[pos] !== '\n') pos += 1;
    } else if (ch === '\n' || ch === '\r') {
      endCommand();
      pos += 1;
      if (ch === '\n' && pending.length > 0) pos = readBodies(scan, pos, end, depth, pending.splice(0));
    } else if (ch === ';' || ch === '|') {
      endCommand();
      pos += 1;
    } else if (ch === '&') {
      if (t[pos + 1] === '>') {
        pos = redirect(pos);
      } else {
        endCommand();
        pos += 1;
      }
    } else if (ch === '(') {
      endCommand();
      groups += 1;
      pos += 1;
    } else if (ch === ')') {
      endCommand();
      if (groups > 0) {
        groups -= 1;
        pos += 1;
      } else if (term === ')') {
        return pos + 1;
      } else {
        pos += 1;
      }
    } else if ((ch === '<' || ch === '>') && t[pos + 1] !== '(') {
      pos = redirect(pos);
    } else {
      const word = readWord(scan, pos, end, depth, tolerant, term);
      const next = word.pos < end ? t[word.pos] : undefined;
      // `2>&1`: a number touching a redirection operator is the file descriptor, no word of the command.
      const descriptor = word.started && !word.quoted && /^[0-9]+$/.test(word.text) && (next === '<' || next === '>');
      if (word.started && !descriptor) words.push(word.text);
      pos = Math.max(word.pos, pos + 1);
    }
  }
  endCommand();
  return term === 'top' ? end : -1;
}

// The commands of a shell line, each as its words, or the reason the line could not be read. A line past a limit is never an empty list of commands.
export type Commands = { ok: true; commands: string[][] } | { ok: false; reason: string };

export function commandsOf(command: string, depth = 0): Commands {
  if (command.length > MAX_COMMAND_CHARS) return { ok: false, reason: `the command is longer than ${MAX_COMMAND_CHARS.toLocaleString('en-US')} characters` };
  const scan: Scan = { text: command, out: [], failure: undefined };
  scanCommands(scan, 0, command.length, depth, 'top', false);
  return scan.failure === undefined ? { ok: true, commands: scan.out } : { ok: false, reason: scan.failure };
}

// ---------------------------------------------------------------------------------------------------------
// Finding the program
// ---------------------------------------------------------------------------------------------------------

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
// A word that begins a command in a compound statement and is not the command: the program is the word after it.
const RESERVED_WORDS: ReadonlySet<string> = new Set(['!', '{', '}', 'then', 'do', 'else', 'elif', 'if', 'while', 'until']);
// Programs that run the command that follows them: the options of each that take a separate value, and the operands (a duration) that come after the options and before the
// command. Options that take none (`time -p`) are skipped as they are met. Looked up with Object.hasOwn: a word that exists only on the object prototype (`constructor`,
// `__proto__`) is a program, not a wrapper (WR-02). `flock` is read apart (flockWords): its lock file may come before or after its `-c` option.
interface WrapperSpec {
  valued: readonly string[];
  operands?: number;
}

const WRAPPERS: Readonly<Record<string, WrapperSpec>> = {
  env: { valued: ['-u', '--unset', '-C', '--chdir', '-P'] },
  command: { valued: [] },
  exec: { valued: ['-a'] },
  nohup: { valued: [] },
  builtin: { valued: [] },
  time: { valued: [] },
  nice: { valued: ['-n', '--adjustment'] },
  sudo: { valued: ['-u', '-g', '-h', '-p', '-C', '-D', '-R', '-T', '-U', '--user', '--group', '--host', '--prompt', '--chdir', '--chroot'] },
  timeout: { valued: ['-s', '--signal', '-k', '--kill-after'], operands: 1 },
  xargs: { valued: ['-a', '--arg-file', '-d', '--delimiter', '-E', '--eof', '-I', '-J', '-L', '--max-lines', '-n', '--max-args', '-P', '--max-procs', '-R', '-S', '-s', '--max-chars'] },
  setsid: { valued: [] },
  stdbuf: { valued: ['-i', '-o', '-e', '--input', '--output', '--error'] },
  ionice: { valued: ['-c', '-n', '-p', '-P', '-u', '--class', '--classdata', '--pid', '--pgid', '--uid'] },
  flock: { valued: ['-w', '--timeout', '-E', '--conflict-exit-code'] },
};

const baseOf = (word: string): string => (word.split('/').pop() ?? '').toLowerCase();

// How many assignment, reserved and wrapper words the classifier reads before the program. A command with more is unparseable: the program cannot be found, so the line
// is refused, never read as "not privileged" (CR-01).
export const MAX_PREFIX_WORDS = 16;

// A command whose program the classifier could not find: it is not an answer of "not privileged".
export interface UnparseableCommand {
  unparseable: string;
}

export const isUnparseable = (found: PrivilegedCommand | null | UnparseableCommand): found is UnparseableCommand => found !== null && 'unparseable' in found;

const isPrefixWord = (word: string): boolean => ASSIGNMENT.test(word) || RESERVED_WORDS.has(word) || Object.hasOwn(WRAPPERS, baseOf(word));

// What `flock [options] lock-file command...` or `flock [options] lock-file -c string` runs: the command words, or `sh -c string` for the string form. The options may come
// before and after the lock file, and the lock file is the first word that is not an option or an option's value.
function flockWords(words: readonly string[]): string[] {
  const valued = (WRAPPERS['flock'] as WrapperSpec).valued;
  let file = false;
  let string: string | undefined;
  let i = 1;
  for (; i < words.length; i += 1) {
    const arg = words[i] as string;
    if (arg === '--') {
      i += 1;
      if (!file && i < words.length) i += 1;
      break;
    }
    if (arg.startsWith('-') && arg !== '-') {
      if (arg === '-c' || arg === '--command') {
        string = words[i + 1];
        i += 1;
      } else if (arg.startsWith('--command=')) {
        string = arg.slice('--command='.length);
      } else if (valued.includes(arg)) {
        i += 1;
      }
    } else if (!file) {
      file = true;
    } else {
      break;
    }
  }
  return string !== undefined ? ['sh', '-c', string] : words.slice(i);
}

// The program and its words with what comes before it removed: assignments, reserved words and wrappers with their options. `env` is what is bound of the prefix (CR-03): the
// assignment words before the program and an `env` wrapper's options and assignments, verbatim and in order. Null when the command runs nothing (`command -v git` only
// looks the program up).
interface Program {
  words: string[];
  env: string[];
}

function programWords(words: readonly string[]): Program | null | UnparseableCommand {
  let rest = [...words];
  const env: string[] = [];
  for (let guard = 0; guard < MAX_PREFIX_WORDS; guard += 1) {
    const first = rest[0];
    if (first === undefined) return { words: rest, env };
    if (ASSIGNMENT.test(first)) {
      env.push(first);
      rest = rest.slice(1);
      continue;
    }
    if (RESERVED_WORDS.has(first)) {
      rest = rest.slice(1);
      continue;
    }
    const wrapper = baseOf(first);
    if (!Object.hasOwn(WRAPPERS, wrapper)) return { words: rest, env };
    if (wrapper === 'flock') {
      rest = flockWords(rest);
      continue;
    }
    const spec = WRAPPERS[wrapper] as WrapperSpec;
    const valued = spec.valued;
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
        env.push(arg, value);
        rest = [...rest.slice(0, i), ...value.split(/\s+/).filter((w) => w !== ''), ...rest.slice(i + 2)];
        i -= 1;
        continue;
      }
      if (wrapper === 'env' && arg.startsWith('--split-string=')) {
        env.push(arg);
        rest = [...rest.slice(0, i), ...arg.slice('--split-string='.length).split(/\s+/).filter((w) => w !== ''), ...rest.slice(i + 1)];
        i -= 1;
        continue;
      }
      if (wrapper === 'env') env.push(arg);
      if (valued.includes(arg)) {
        i += 1;
        if (wrapper === 'env' && rest[i] !== undefined) env.push(rest[i] as string);
      }
    }
    rest = rest.slice(i + (spec.operands ?? 0));
  }
  const next = rest[0];
  if (next !== undefined && isPrefixWord(next)) return { unparseable: `more than ${MAX_PREFIX_WORDS} assignment, reserved or wrapper words before the program` };
  return { words: rest, env };
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

// npm's command names and aliases, each mapped to the command it runs (plan 04-51; WR-03), as npm resolves them (lib/utils/cmd-list.js). npm also accepts any unambiguous
// abbreviation of a name (`npm pub`), which npmCommandOf resolves.
const NPM_COMMAND_NAMES: readonly string[] = [
  'access', 'adduser', 'approve-scripts', 'audit', 'bin', 'bugs', 'cache', 'ci', 'completion', 'config', 'dedupe', 'deny-scripts', 'deprecate', 'diff', 'dist-tag', 'docs', 'doctor',
  'edit', 'exec', 'explain', 'explore', 'find-dupes', 'fund', 'get', 'help', 'help-search', 'hook', 'init', 'install', 'install-ci-test', 'install-scripts', 'install-test', 'link',
  'll', 'login', 'logout', 'ls', 'org', 'outdated', 'owner', 'pack', 'ping', 'pkg', 'prefix', 'profile', 'prune', 'publish', 'query', 'rebuild', 'repo', 'restart', 'root', 'run',
  'sbom', 'search', 'set', 'set-script', 'shrinkwrap', 'stage', 'star', 'stars', 'start', 'stop', 'team', 'test', 'token', 'trust', 'undeprecate', 'uninstall', 'unpublish', 'unstar',
  'update', 'version', 'view', 'whoami',
];
const NPM_ALIASES: Readonly<Record<string, string>> = {
  author: 'owner', home: 'docs', issues: 'bugs', info: 'view', show: 'view', find: 'search', add: 'install', unlink: 'uninstall', remove: 'uninstall', rm: 'uninstall', r: 'uninstall',
  un: 'uninstall', rb: 'rebuild', list: 'ls', ln: 'link', create: 'init', i: 'install', it: 'install-test', cit: 'install-ci-test', u: 'update', up: 'update', c: 'config', s: 'search',
  se: 'search', tst: 'test', t: 'test', ddp: 'dedupe', v: 'view', 'run-script': 'run', 'clean-install': 'ci', 'clean-install-test': 'install-ci-test', x: 'exec', why: 'explain',
  la: 'll', verison: 'version', ic: 'ci', innit: 'init', in: 'install', ins: 'install', inst: 'install', insta: 'install', instal: 'install', isnt: 'install', isnta: 'install',
  isntal: 'install', isntall: 'install', 'install-clean': 'ci', 'isntall-clean': 'ci', hlep: 'help', 'dist-tags': 'dist-tag', upgrade: 'update', udpate: 'update', rum: 'run', sit: 'install-ci-test',
  urn: 'run', ogr: 'org', 'add-user': 'adduser',
};
export const NPM_COMMANDS: Readonly<Record<string, string>> = Object.freeze({ ...Object.fromEntries(NPM_COMMAND_NAMES.map((name) => [name, name])), ...NPM_ALIASES });

// The npm command a word names: an exact command or alias, else the one command that every name beginning with the word resolves to.
function npmCommandOf(word: string): string | undefined {
  if (Object.hasOwn(NPM_COMMANDS, word)) return NPM_COMMANDS[word];
  const resolved = new Set<string>();
  for (const [name, command] of Object.entries(NPM_COMMANDS)) if (name.startsWith(word)) resolved.add(command);
  return resolved.size === 1 ? [...resolved][0] : undefined;
}

// The npm options that take a separate value, so the value is not mistaken for the subcommand (`npm --loglevel info publish`, `npm --prefix test publish`). An option missing
// here whose value is the name of an npm command is the one way to hide the subcommand; the line digest and the SCM platform's protections are what hold then.
const NPM_VALUED_OPTIONS: readonly string[] = [
  '--access', '--auth-type', '--before', '--ca', '--cache', '--cafile', '--call', '--cert', '--ci-name', '--cidr', '--cwd', '--depth', '--diff', '--diff-dst-prefix', '--diff-src-prefix',
  '--diff-unified', '--editor', '--fetch-retries', '--fetch-retry-factor', '--fetch-retry-maxtimeout', '--fetch-retry-mintimeout', '--fetch-timeout', '--globalconfig', '--heading',
  '--https-proxy', '--include', '--init-author-email', '--init-author-name', '--init-author-url', '--init-license', '--init-module', '--init-version', '--install-strategy', '--key',
  '--local-address', '--location', '--lockfile-version', '--loglevel', '--logs-dir', '--logs-max', '--maxsockets', '--message', '--node-options', '--node-version', '--noproxy',
  '--npm-version', '--omit', '--otp', '--pack-destination', '--package', '--prefix', '--preid', '--provenance-file', '--proxy', '--registry', '--save-prefix', '--scope', '--script-shell',
  '--searchexclude', '--searchlimit', '--searchopts', '--searchstaleness', '--shell', '--tag', '--tag-version-prefix', '--umask', '--user-agent', '--userconfig', '--viewer', '--which',
  '--workspace', '--expect-result-count', '--expect-results', '--min-release-age', '-C', '-w', '-m', '-c',
];

const NPM_PUBLISH: ArgSpec = {
  valued: { ...Object.fromEntries(NPM_VALUED_OPTIONS.map((name) => [name, null])), '--registry': 'registry', '--tag': 'tag', '--access': 'access' },
  positional: ['package', 'operands*'],
};

// A shell started on a string (plan 04-51; WR-01): the string after `-c` among its options. Undefined when the shell is not given one (a script, standard input, no `-c`).
const SHELLS: readonly string[] = ['sh', 'bash', 'zsh', 'dash', 'ksh'];
const SHELL_VALUED: readonly string[] = ['-o', '+o', '-O', '+O', '--rcfile', '--init-file'];

function shellString(args: readonly string[]): string | undefined {
  let command = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg === '--') return command ? args[i + 1] : undefined;
    if ((!arg.startsWith('-') && !arg.startsWith('+')) || arg === '-' || arg === '+') return command ? arg : undefined;
    if (SHELL_VALUED.includes(arg)) i += 1;
    else if (/^-[A-Za-z]+$/.test(arg) && arg.includes('c')) command = true;
  }
  return undefined;
}

function classifyGit(args: readonly string[]): PrivilegedCommand | null {
  let i = 0;
  // The global options before the subcommand, verbatim with their values: `-c remote.origin.url=...` and `-C dir` redirect the push, so an approval binds them (CR-03).
  const globals: string[] = [];
  for (; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (!arg.startsWith('-') || arg === '-') break;
    globals.push(arg);
    if (GIT_VALUED_GLOBALS.includes(arg) && i + 1 < args.length) {
      i += 1;
      globals.push(args[i] as string);
    }
  }
  if (args[i] !== 'push') return null;
  const form = formOf('git', ['push']) as CommandForm;
  const params = paramsOf(parseArgs(args.slice(i + 1), GIT_PUSH), GIT_PUSH);
  if (globals.length > 0) params['gitOptions'] = globals.join(' ');
  return { action: form.action, params };
}

// Why a gh api request cannot be approved when its body is not on the line: the line digest binds only the words the owner saw, and a file or standard input is not one.
const BODY_FROM_FILE = 'the request body comes from a file or standard input, which an approval cannot bind; pass the fields inline with -f name=value or -F name=value';

// Whether a `gh api` request takes its body from a file or standard input: `--input`, or a `-F`/`--field` value (`name=@file`, `name=@-`) that starts with @. A raw `-f` value
// starting with @ is a literal string. The values of the other options are skipped, so a header that mentions `-F` is no field.
function ghApiBodyFromFile(args: readonly string[], spec: ArgSpec): boolean {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg === '--') break;
    if (arg === '--input' || arg.startsWith('--input=')) return true;
    let field: string | undefined;
    if (arg === '-F' || arg === '--field') {
      field = args[i + 1];
      i += 1;
    } else if (arg.startsWith('--field=')) {
      field = arg.slice('--field='.length);
    } else if (arg.startsWith('-F') && !arg.startsWith('--')) {
      field = arg.slice(2);
    } else if (Object.hasOwn(spec.valued, arg)) {
      i += 1;
    }
    if (field !== undefined) {
      const eq = field.indexOf('=');
      if (eq !== -1 && field.slice(eq + 1).startsWith('@')) return true;
    }
  }
  return false;
}

// The gh options that may stand between a group and its subcommand (`gh pr -R x/y create`, plan 04-57; GWR-01, T-04-150): `-R` and `--repo` take the next word as their value,
// `--repo=x` and `-Rx` are one word, and any other word that starts with `-` is skipped alone. Returns the subcommand and the words that are not it: the leading options
// followed by the words after the subcommand, so the form's own spec binds `-R` wherever it was written. Undefined when no subcommand follows.
function ghGroupWords(args: readonly string[]): { subcommand: string; rest: string[] } | undefined {
  const leading: string[] = [];
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (!arg.startsWith('-') || arg === '-') return { subcommand: arg, rest: [...leading, ...args.slice(i + 1)] };
    leading.push(arg);
    if ((arg === '-R' || arg === '--repo') && i + 1 < args.length) {
      i += 1;
      leading.push(args[i] as string);
    }
  }
  return undefined;
}

function classifyGh(args: readonly string[]): PrivilegedCommand | null {
  let key = 'api';
  let rest: readonly string[] = args.slice(1);
  if (args[0] !== 'api') {
    const group = ghGroupWords(args);
    if (group === undefined) return null;
    key = `${args[0] ?? ''} ${group.subcommand}`;
    rest = group.rest;
  }
  const spec = GH_FORMS[key];
  const form = formOf('gh', key.split(' '));
  if (spec === undefined || form === undefined) return null;
  const parsed = parseArgs(rest, spec);
  if (form.action === 'scm.api.write') {
    const given = parsed.values['method']?.toUpperCase();
    const method = given ?? (GH_API_FIELD_OPTIONS.some((option) => parsed.seen.has(option)) ? 'POST' : 'GET');
    if (method === 'GET') return null;
    parsed.values['method'] = method;
    if (ghApiBodyFromFile(args.slice(1), spec)) return { action: form.action, params: paramsOf(parsed, spec), unapprovable: BODY_FROM_FILE };
  }
  return { action: form.action, params: paramsOf(parsed, spec) };
}

function classifyNpm(args: readonly string[]): PrivilegedCommand | null {
  const parsed = parseArgs(args, NPM_PUBLISH);
  // The subcommand is the first positional that is an npm command (an option's value npm does not know is skipped), so `npm install publish` is an install. It and what
  // precedes it are dropped by position: the positionals that remain are the package and its operands.
  const at = parsed.positionals.findIndex((word) => npmCommandOf(word) !== undefined);
  if (at === -1 || npmCommandOf(parsed.positionals[at] as string) !== 'publish') return null;
  parsed.positionals = parsed.positionals.slice(at + 1);
  const form = formOf('npm', ['publish']) as CommandForm;
  return { action: form.action, params: paramsOf(parsed, NPM_PUBLISH) };
}

// The privileged commands one command runs, or an unparseable command whose program (or whose shell string) could not be read. `words` are the words of a single command
// (no `;`, `&&` or `|`). A shell started on a literal string and `eval` run the commands of their string (plan 04-51; WR-01): the string is read by the same scanner one
// level deeper, so a computed string (`bash -c "$X"`, text left to a variable or a substitution) holds no command of its own, while the commands of a substitution inside it
// were already scanned with the line.
function classifyWords(words: readonly string[], depth: number): PrivilegedCommand[] | UnparseableCommand {
  const program = programWords(words);
  if (program === null) return [];
  if ('unparseable' in program) return program;
  if (program.words.length === 0) return [];
  const args = program.words.slice(1);
  const name = baseOf(program.words[0] as string);
  let found: PrivilegedCommand[];
  if (name === 'git' || name === 'gh' || name === 'npm') {
    const one = name === 'git' ? classifyGit(args) : name === 'gh' ? classifyGh(args) : classifyNpm(args);
    found = one === null ? [] : [one];
  } else if (SHELLS.includes(name) || name === 'eval') {
    const text = name === 'eval' ? (args.length > 0 ? args.join(' ') : undefined) : shellString(args);
    if (text === undefined) return [];
    const nested = classifyString(text, depth + 1);
    if ('unparseable' in nested) return nested;
    found = nested;
  } else {
    return [];
  }
  if (program.env.length > 0) {
    for (const command of found) command.params['env'] = [program.env.join(' '), command.params['env']].filter((part) => part !== undefined).join(' ');
  }
  return found;
}

// The privileged commands of a string that a shell or eval runs, `depth` levels below the line.
function classifyString(text: string, depth: number): PrivilegedCommand[] | UnparseableCommand {
  const split = commandsOf(text, depth);
  if (!split.ok) return { unparseable: split.reason };
  const commands: PrivilegedCommand[] = [];
  for (const words of split.commands) {
    const found = classifyWords(words, depth);
    if ('unparseable' in found) return found;
    commands.push(...found);
  }
  return commands;
}

// The privileged action the first privileged command of one command is, null for a command that is not privileged, or an unparseable command whose program could not be
// found. `words` are the words of a single command (no `;`, `&&` or `|`); classifyLine answers for every command a line holds.
export function classifyShellCommand(words: readonly string[]): PrivilegedCommand | null | UnparseableCommand {
  const found = classifyWords(words, 0);
  if ('unparseable' in found) return found;
  return found[0] ?? null;
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
  // Binds the whole line to the approval: an earlier cd, a git config, a wrapper's options or a gh api body change a command's effect without changing its own words.
  const line = `sha256:${sha256Hex(command).slice(0, 32)}`;
  for (const words of split.commands) {
    const found = classifyWords(words, 0);
    if ('unparseable' in found) return { kind: 'unparseable', reason: found.unparseable };
    for (const one of found) commands.push({ ...one, params: { ...one.params, line } });
  }
  return commands.length === 0 ? { kind: 'none' } : { kind: 'privileged', commands };
}

// The reason the model is told with a refusal of a privileged form: the action, and the command the owner runs to approve it.
export function privilegedReason(action: string, requestId: string): string {
  return `${action} needs an approval for these parameters; the owner approves it at a terminal with: avarice approve ${requestId}`;
}

// The reason for a line with several privileged commands that lack an approval (plan 04-48; CR-04): one clause for each, in the order the commands appear.
export function privilegedLineReason(entries: readonly { action: string; requestId: string }[]): string {
  return entries.map((entry) => privilegedReason(entry.action, entry.requestId)).join('; ');
}
