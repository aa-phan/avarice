// The privileged-command line classifier (plan 04-40; FR-12, CR-01, CR-02, WR-01, WR-02; threats T-04-105, T-04-106). classifyLine answers one of three things about a
// shell line: nothing privileged, the privileged commands it holds, or "could not be read". An unreadable line is never an answer of "nothing privileged".
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { NPM_COMMANDS, UNAPPROVABLE_RULE, classifyLine, classifyShellCommand, isUnparseable } from '../../src/domain/privileged-commands.ts';
import { runUnderShell, shellAvailable } from '../helpers/shell-oracle.ts';
import type { Shell } from '../helpers/shell-oracle.ts';

// `git push origin main #` followed by x up to exactly `length` characters: the comment keeps the line a push whatever its length.
const pushOfLength = (length: number): string => {
  const head = 'git push origin main #';
  return head + 'x'.repeat(length - head.length);
};

// A push inside `depth` command substitutions.
const nested = (depth: number): string => `${'echo $('.repeat(depth)}git push${')'.repeat(depth)}`;

const actionsOf = (line: string): string[] => {
  const found = classifyLine(line);
  return found.kind === 'privileged' ? found.commands.map((c) => c.action) : [];
};

describe('the length limit is exact: 65,536 characters classify and one more is unparseable (CR-01, FR-12)', () => {
  it('classifies a git push command of exactly 65,536 characters as git.push', () => {
    const command = pushOfLength(65_536);
    assert.equal(command.length, 65_536);
    const found = classifyLine(command);
    assert.equal(found.kind, 'privileged');
    if (found.kind === 'privileged') assert.equal(found.commands[0]?.action, 'git.push');
  });

  it('says unparseable, naming the limit, for a line of 65,537 characters', () => {
    const command = pushOfLength(65_537);
    assert.equal(command.length, 65_537);
    const found = classifyLine(command);
    assert.equal(found.kind, 'unparseable');
    if (found.kind === 'unparseable') assert.match(found.reason, /65,536/);
  });
});

describe('the nesting limit is exact: 8 nested substitutions classify and 9 are unparseable (CR-01, FR-12)', () => {
  it('classifies a push inside 8 nested command substitutions', () => {
    assert.deepEqual(actionsOf(nested(8)), ['git.push']);
  });

  it('says unparseable, naming the limit, for a push inside 9', () => {
    const found = classifyLine(nested(9));
    assert.equal(found.kind, 'unparseable');
    if (found.kind === 'unparseable') assert.match(found.reason, /nested/);
  });
});

// `command` is a wrapper, so each repetition is one word before the program; the classifier reads 16 and refuses a line with more.
const prefixed = (words: number): string => `${'command '.repeat(words)}git push origin main`;

describe('the prefix limit is exact: 16 leading wrapper words classify and 17 are unparseable (CR-01, FR-12)', () => {
  it('classifies a push behind 16 wrapper words', () => {
    assert.deepEqual(actionsOf(prefixed(16)), ['git.push']);
  });

  it('says unparseable, naming the limit, for a push behind 17 wrapper words', () => {
    const found = classifyLine(prefixed(17));
    assert.equal(found.kind, 'unparseable');
    if (found.kind === 'unparseable') assert.match(found.reason, /16/);
  });

  it('counts assignments and reserved words with the wrappers', () => {
    assert.deepEqual(actionsOf(`${'A=1 '.repeat(16)}git push`), ['git.push']);
    assert.equal(classifyLine(`${'A=1 '.repeat(17)}git push`).kind, 'unparseable');
  });
});

describe('the wrapper table answers only for its own keys (WR-02)', () => {
  for (const line of ['constructor -x', 'constructor git push', '__proto__ git push', 'toString -x git push', 'hasOwnProperty git push']) {
    it(`reads ${JSON.stringify(line)} as a command that is no wrapper and is not privileged`, () => {
      assert.deepEqual(classifyLine(line), { kind: 'none' });
    });
  }
});

describe('time and its -p option are a wrapper (WR-01)', () => {
  it('classifies a push run under time -p, time and time --', () => {
    for (const line of ['time -p git push origin main', 'time git push origin main', 'time -p -- git push origin main', 'time -p env FOO=1 git push origin main']) {
      assert.deepEqual(actionsOf(line), ['git.push'], line);
    }
  });
});

// Lines in which the shell runs a push that the old splitter lost or misread (CR-02, WR-01).
const FINDS_PUSH: ReadonlyArray<readonly [string, string]> = [
  ['a quoted `)` inside a substitution', 'echo $(echo ")"; git push)'],
  ['a quoted `)` inside a substitution inside double quotes', 'echo "$(echo ")"; git push)"'],
  ['a quoted `)` inside backticks inside double quotes', "echo \"`echo ')'`\"; git push"],
  ['a comment with an apostrophe before the push line', "ls # it's fine\ngit push"],
  ['a here-string', 'cat <<< "a b"; git push'],
  ['a substitution as a redirection target', 'cat > $(git push) < /dev/null'],
  ['a process substitution', 'diff <(git push) x'],
  ['a process substitution as a redirection target', 'cat < <(git push)'],
  ['a here-document whose unquoted body holds a substitution', 'cat <<EOF\n$(git push)\nEOF'],
  ['a here-document body fed to a shell', "bash <<'EOF'\ngit push\nEOF"],
  ['an ANSI-C quoted word holding an escaped quote', "$'it\\'s'; git push"],
  ['an ANSI-C quoted program name', "$'\\x67it' push origin main"],
  ['arithmetic before the push', 'echo $((1+2)); git push'],
  ['a substitution in a parameter default', 'echo ${NOPE:-$(git push)}'],
  ['a push inside 8 nested substitutions', nested(8)],
];

// Lines the old splitter or the new scanner must read as one push (CR-02): the push is in the line, whatever way the quotes fall.
describe('classifyLine finds the push the shell would run (CR-02, WR-01)', () => {
  for (const [what, line] of FINDS_PUSH) {
    it(`${what}: ${JSON.stringify(line.slice(0, 50))}`, () => {
      assert.deepEqual(actionsOf(line).slice(0, 1), ['git.push']);
    });
  }
});

describe('classifyLine says unparseable for a line it cannot read, never none (CR-01, WR-01)', () => {
  for (const line of [nested(9), 'echo "unterminated', 'echo $(git status', 'echo `x', "echo 'unterminated", "echo $'unterminated", 'echo "$(git push"']) {
    it(JSON.stringify(line), () => {
      assert.equal(classifyLine(line).kind, 'unparseable');
    });
  }
});

// The commit message of the repository's own workflow: a here-document in a substitution, holding apostrophes, parentheses and a comment-like line.
export const COMMIT_WITH_HEREDOC = ['git commit -m "$(cat <<\'EOF\'', "Fix the planner's (scope) handling", "# what's next", 'we should git push later', 'EOF', ')"'].join('\n');

describe('classifyLine says none for lines that only mention a push (CR-02)', () => {
  it('a git commit whose here-document message holds apostrophes, parentheses, a comment line and the words git push', () => {
    assert.deepEqual(classifyLine(COMMIT_WITH_HEREDOC), { kind: 'none' });
  });

  it('a quoted push, and a here-document of prose with apostrophes', () => {
    assert.deepEqual(classifyLine("echo 'git push'"), { kind: 'none' });
    assert.deepEqual(classifyLine("cat <<'EOF'\nit's prose, with (parens)\nEOF"), { kind: 'none' });
  });

  it('a push line that a backslash-newline joined to the previous command as an argument', () => {
    assert.deepEqual(classifyLine('echo hi \\\ngit push'), { kind: 'none' });
  });
});

describe('reads a line of 65,536 characters made of quotes, parentheses and dollar signs in under 200 ms (CR-01)', () => {
  const lineOf = (unit: string): string => unit.repeat(Math.ceil(65_536 / unit.length)).slice(0, 65_536);
  // The first holds a quoted `)` inside a substitution and an arithmetic expansion in every repetition and scans to the end; the others end in a refusal or a tolerant body.
  const adversarial: ReadonlyArray<readonly [string, string]> = [
    ['balanced substitutions and groups', lineOf('echo "$(echo \')\')" \'(\' $((1)) ; ')],
    ['unclosed quotes and parentheses', lineOf('"($)"\'$()\'')],
    ['backquotes inside backquotes', lineOf('`echo \\`x\\`` ')],
    ['a here-document body of quotes and substitutions', `cat <<A\n${lineOf('\'"$(`\n').slice(0, 65_536 - 'cat <<A\n'.length)}`],
    ['words of braces, commas, dots, brackets and globs (GWR-02)', lineOf('git status {a,..}*?[] ')],
    ['one word of unclosed braces and commas (GWR-02)', ('echo ' + '{,'.repeat(40_000)).slice(0, 65_536)],
  ];
  for (const [what, line] of adversarial) {
    it(what, () => {
      assert.equal(line.length, 65_536);
      const started = performance.now();
      const found = classifyLine(line);
      const ms = performance.now() - started;
      assert.ok(ms < 200, `took ${ms.toFixed(1)} ms`);
      assert.notEqual(found.kind, 'privileged');
    });
  }
});

// ---------------------------------------------------------------------------------------------------------
// The differential oracle (T-04-106): bash itself, and zsh where it is installed, run each line with stub git, gh and npm; every privileged invocation the shell
// performs is one classifyLine returned. `runs` is how many privileged invocations bash performs at least, so a stub that fails to run cannot make the test pass by doing nothing.
// ---------------------------------------------------------------------------------------------------------

interface CorpusLine {
  line: string;
  runs: number;
}

const corpus = (...entries: ReadonlyArray<readonly [string, number]>): CorpusLine[] => entries.map(([line, runs]) => ({ line, runs }));

// Lines whose form the machine's shell may not support (coproc is no part of bash 3.2, which is what /bin/bash is on macOS): no run count, but every invocation a shell does perform
// must still be one classifyLine returned.
export const SHELL_DEPENDENT: readonly CorpusLine[] = corpus(['coproc git push; wait', 0]);

export const CORPUS: readonly CorpusLine[] = corpus(
  ['git push origin main', 1],
  ['git -C . push origin main', 1],
  ['env git push origin main', 1],
  ['env -i FOO=1 git push origin main', 1],
  ['FOO=1 BAR=2 git push origin main', 1],
  ['FOO="a b" git push origin main', 1],
  ['command git push origin main', 1],
  ['exec git push origin main', 1],
  ['time git push origin main', 1],
  ['time -p git push origin main', 1],
  ["git 'push' origin main", 1],
  ['cd . && git push origin main', 1],
  ['echo ok; git push origin main', 1],
  ['false || git push origin main', 1],
  ['echo done | git push origin main', 1],
  ['echo $(git push origin main)', 1],
  ['echo "$(git push origin main)"', 1],
  ['echo `git push origin main`', 1],
  ['(git push origin main)', 1],
  ['{ git push origin main; }', 1],
  ['if true; then git push origin main; fi', 1],
  ['if git push; then echo ok; fi', 1],
  ['for x in a; do git push origin $x; done', 1],
  ['case x in x) git push;; esac', 1],
  ['! git push', 1],
  ['git push\nls', 1],
  ['echo $(echo ")"; git push)', 1],
  ['echo "$(echo ")"; git push)"', 1],
  ["echo \"`echo ')'`\"; git push", 1],
  ["ls # it's fine\ngit push", 1],
  ['cat <<< "a b"; git push', 1],
  ['cat > $(git push) < /dev/null', 1],
  ['diff <(git push) x', 1],
  ['cat < <(git push)', 1],
  ['cat <<EOF\n$(git push)\nEOF', 1],
  ["bash <<'EOF'\ngit push\nEOF", 1],
  ["$'it\\'s'; git push", 1],
  [nested(8), 1],
  ['echo $((1+2)); git push', 1],
  ['echo ${NOPE:-$(git push)}', 1],
  ['echo "${NOPE:-$(git push)}"', 1],
  ['x=$(git push origin main)', 1],
  ['echo "a $(git push) b"', 1],
  ['git push >/dev/null 2>&1', 1],
  ['2>/dev/null git push origin main', 1],
  ['git push &>/dev/null', 1],
  ['echo hi > out.txt; git push', 1],
  ['git push; # a trailing comment with git push', 1],
  ['echo foo#bar; git push', 1],
  ['echo "a\\"b"; git push origin main', 1],
  ["echo 'a'\"b\"'c'; git push", 1],
  ['git push --force origin main', 1],
  ['git push origin a; git push origin b', 2],
  ['echo a && { echo b; git push origin main; }', 1],
  ['gh pr create --title x --base main', 1],
  ['gh pr merge 12 --squash', 1],
  ['gh api repos/o/r/pulls -X POST', 1],
  // A gh persistent flag between the group and the subcommand (plan 04-57; GWR-01).
  ['gh pr -R x/y create', 1],
  ['gh pr --repo=x/y merge 1', 1],
  ['gh release -R x create v1', 1],
  ['gh pr -Rx/y edit 3', 1],
  // A brace expansion forms the command (plan 04-62; GWR-02): the shell runs `git push pus`, `git push origin main` and `git gt push`; classifyLine answers unparseable for each.
  ['git pus{h,}', 1],
  ['{git,push} origin main', 1],
  ['g{i,}t push', 0],
  ['npm test && npm publish', 1],
  ['npm publish', 1],
  // More wrappers and launchers (plan 04-63; GIN-02): the stubs for them are in the oracle's stub directory, and find is the system one.
  ['find . -maxdepth 0 -exec git push \\;', 1],
  ['find . -maxdepth 0 -execdir git push {} +', 1],
  ['parallel git push ::: a', 1],
  ["parallel ::: 'git push'", 1],
  ['watch git push', 1],
  ['watch -x git push', 1],
  ['doas git push', 1],
  ['taskset 1 git push', 1],
  ['taskset -c 0 git push', 1],
  ['arch -arm64 git push', 1],
  ['caffeinate git push', 1],
  ['unbuffer git push', 1],
  ['chronic git push', 1],
  ['taskset -p 1234', 0],
  ["find . -name '*.ts'", 0],
  // A shell string in su and trap, and a here-string given to a shell (plan 04-63; GIN-02).
  ["su -c 'git push'", 1],
  ["su - me -c 'git push'", 1],
  ["su --command='git push'", 1],
  ['su -l me', 0],
  ["trap 'git push' EXIT", 1],
  ["trap -- 'git push' EXIT", 1],
  ['trap EXIT', 0],
  ['trap - INT', 0],
  ["bash <<< 'git push'", 1],
  ['sh <<<"git push"', 1],
  ["bash -c true <<< 'git push'", 0],
  ["bash script.sh <<< 'git push'", 0],
  // Another program starts the command (plan 04-51; WR-01, WR-03): the stubs for the shells and the wrappers are linked into the stub directory, so a shell
  // started on a literal string really runs the stub.
  ['bash -c "git push origin main"', 1],
  ["sh -c 'npm publish'", 1],
  ['eval "git push"', 1],
  ['eval git push origin main', 1],
  ['timeout 5 git push', 1],
  ['xargs git push', 1],
  ['setsid git push', 1],
  ['stdbuf -o0 git push', 1],
  ['ionice -c3 git push', 1],
  ['flock /tmp/l git push', 1],
  ["flock /tmp/l -c 'git push'", 1],
  ["bash -c 'echo hi; git push origin main'", 1],
  ["bash -c \"bash -c 'git push origin main'\"", 1],
  ['bash -c "echo $(git push)"', 1],
  ['FOO=1 sh -c "git push"', 1],
  ['bash -c "$X"', 0],
  ['sh -c "$(cat f)"', 0],
  ['bash -c "echo git push"', 0],
  ['npm --scope @x publish', 1],
  ['npm --fetch-retries 3 publish', 1],
  ['npm --cwd pkg publish', 1],
  ['npm install publish', 0],
  ['npm view publish', 0],
  ['gh api repos/o/r/pulls', 0],
  ['git status', 0],
  ["echo 'git push'", 0],
  ['echo hi \\\ngit push', 0],
  ["cat <<'EOF'\nit's prose, with (parens)\nEOF", 0],
  [COMMIT_WITH_HEREDOC, 0],
);

describe('the differential oracle: every privileged command a shell runs on the corpus is one classifyLine returns (T-04-106)', () => {
  it('holds at least 40 lines', () => {
    assert.ok(CORPUS.length >= 40, `${CORPUS.length} lines`);
  });

  for (const shell of ['bash', 'zsh'] as const satisfies readonly Shell[]) {
    const available = shellAvailable(shell);
    it(`under ${shell}${available ? '' : ' (skipped: /bin/zsh is not installed on this machine)'}`, { skip: available ? false : `${shell} is not installed` }, () => {
      for (const { line, runs } of [...CORPUS, ...SHELL_DEPENDENT]) {
        const performed = runUnderShell(shell, line)
          .flatMap((argv) => {
            const found = classifyShellCommand(argv);
            return found === null || isUnparseable(found) ? [] : [found];
          });
        // bash expands a redirection target twice when the redirection fails, so a line may run a command more often than it names it: at least `runs`, and none for a line that only mentions one.
        if (shell === 'bash' && !SHELL_DEPENDENT.some((entry) => entry.line === line)) assert.ok(runs === 0 ? performed.length === 0 : performed.length >= runs, `bash performed ${performed.length} privileged commands, expected ${runs}: ${JSON.stringify(line)}`);
        const found = classifyLine(line);
        // A line classifyLine refuses as unparseable covers every invocation it runs: both callers refuse such a line (plan 04-62; GWR-02), so none of them runs unapproved.
        if (found.kind === 'unparseable') continue;
        const commands = found.kind === 'privileged' ? found.commands : [];
        for (const one of performed) {
          assert.ok(
            commands.some((c) => c.action === one.action),
            `${shell} ran ${one.action} but classifyLine did not return it for ${JSON.stringify(line)} (${found.kind})`,
          );
        }
      }
    });
  }
});

// ---------------------------------------------------------------------------------------------------------
// What an approval binds (plan 04-51; CR-03, FR-12, T-04-136): git's global options, the assignments before the program, the whole line.
// ---------------------------------------------------------------------------------------------------------

const firstOf = (line: string): { action: string; params: Record<string, string> } => {
  const found = classifyLine(line);
  assert.equal(found.kind, 'privileged', line);
  return found.kind === 'privileged' ? (found.commands[0] as { action: string; params: Record<string, string> }) : { action: '', params: {} };
};
const lineDigest = (text: string): string => `sha256:${createHash('sha256').update(text).digest('hex').slice(0, 32)}`;

describe('a push redirected by a git global option is not the plain push (CR-03, FR-12, T-04-136)', () => {
  it('the -c push has other params than the plain push, and names the option words', () => {
    const plain = firstOf('git push origin main');
    const redirected = firstOf('git -c remote.origin.url=https://evil/x.git push origin main');
    assert.notDeepEqual(redirected.params, plain.params, 'the verifier reproduction: equal params for the plain and the -c push');
    assert.equal(redirected.params['gitOptions'], '-c remote.origin.url=https://evil/x.git');
    assert.equal(redirected.action, 'git.push');
    assert.equal(redirected.params['remote'], 'origin');
    assert.equal(redirected.params['refspec'], 'main');
    assert.equal(plain.params['gitOptions'], undefined, 'a plain push carries no gitOptions');
  });

  it('keeps every skipped global option word with its value, verbatim and in order', () => {
    assert.equal(firstOf('git -C /other push origin main').params['gitOptions'], '-C /other');
    assert.equal(firstOf('git -C /tmp/x -c user.name=x --no-pager push origin main').params['gitOptions'], '-C /tmp/x -c user.name=x --no-pager');
    assert.equal(firstOf('git --git-dir=/tmp/x/.git push origin main').params['gitOptions'], '--git-dir=/tmp/x/.git');
    assert.notDeepEqual(firstOf('git -C /a push origin main').params, firstOf('git -C /b push origin main').params);
  });
});

describe('assignments and env options before the program are bound as env (CR-03, FR-12, T-04-136)', () => {
  it('names the assignment words before the program, in order', () => {
    assert.equal(firstOf('FOO=1 BAR=2 git push origin main').params['env'], 'FOO=1 BAR=2');
    assert.equal(firstOf('GIT_SSH_COMMAND=x git push origin main').params['env'], 'GIT_SSH_COMMAND=x');
    assert.equal(firstOf('git push origin main').params['env'], undefined);
  });

  it('names the options and assignments an env wrapper is given', () => {
    assert.equal(firstOf('env -i FOO=1 git push origin main').params['env'], '-i FOO=1');
    assert.equal(firstOf('A=1 env -u HOME B=2 git push origin main').params['env'], 'A=1 -u HOME B=2');
  });

  it('every privileged form carries env, not only git', () => {
    assert.equal(firstOf('GH_REPO=evil/repo gh pr create --base main').params['env'], 'GH_REPO=evil/repo');
    assert.equal(firstOf('HOME=/x npm publish').params['env'], 'HOME=/x');
    assert.notDeepEqual(firstOf('GH_REPO=evil/repo gh pr create --base main').params, firstOf('gh pr create --base main').params);
  });
});

describe('the line digest binds everything else on the line (CR-03, FR-12, T-04-136)', () => {
  it('is sha256: and the first 32 hex digits of the SHA-256 of the exact command text, on every privileged command', () => {
    const text = 'git push origin main';
    assert.equal(firstOf(text).params['line'], lineDigest(text));
    assert.match(firstOf(text).params['line'] as string, /^sha256:[0-9a-f]{32}$/);
    const two = classifyLine('git push a; npm publish');
    assert.equal(two.kind, 'privileged');
    if (two.kind === 'privileged') for (const command of two.commands) assert.equal(command.params['line'], lineDigest('git push a; npm publish'));
  });

  it('another line around the same command is another digest, so an earlier cd or a trailing option cannot ride on the approval', () => {
    const plain = firstOf('git push origin main').params['line'];
    assert.notEqual(firstOf('cd /x && git push origin main').params['line'], plain);
    assert.notEqual(firstOf('git push origin main  ').params['line'], plain, 'the exact text, not a normalized one');
    assert.notEqual(firstOf('git config remote.origin.url https://evil/x.git; git push origin main').params['line'], plain);
  });

  it('classifyShellCommand, which sees one command and not the line, adds no line', () => {
    assert.deepEqual(classifyShellCommand(['git', 'push', 'origin', 'main']), { action: 'git.push', params: { remote: 'origin', refspec: 'main' } });
  });
});

// ---------------------------------------------------------------------------------------------------------
// A push or a publish started through another program (plan 04-51; WR-01, WR-03, T-04-137)
// ---------------------------------------------------------------------------------------------------------

describe('a shell started on a literal string, eval and the wrappers run the command they are given (WR-01, T-04-137)', () => {
  const FORMS: ReadonlyArray<readonly [string, string]> = [
    ['bash -c "git push origin main"', 'git.push'],
    ["sh -c 'npm publish'", 'release.publish'],
    ['eval "git push"', 'git.push'],
    ['eval git push origin main', 'git.push'],
    ['timeout 5 git push', 'git.push'],
    ['timeout -s KILL 5 git push', 'git.push'],
    ['timeout --signal=KILL --foreground 5 git push', 'git.push'],
    ['xargs git push', 'git.push'],
    ['xargs -n 1 -I{} git push {}', 'git.push'],
    ['setsid git push', 'git.push'],
    ['setsid -f git push', 'git.push'],
    ['stdbuf -o0 git push', 'git.push'],
    ['stdbuf -o 0 -e L git push', 'git.push'],
    ['ionice -c3 git push', 'git.push'],
    ['ionice -c 2 -n 7 git push', 'git.push'],
    ['flock /tmp/l git push', 'git.push'],
    ['flock -w 5 /tmp/l git push', 'git.push'],
    ["flock /tmp/l -c 'git push'", 'git.push'],
    ["flock -c 'git push' /tmp/l", 'git.push'],
    ["bash -lc 'git push origin main'", 'git.push'],
    ["/bin/zsh -f -c 'git push'", 'git.push'],
    ["dash -c 'git push'", 'git.push'],
    ["ksh -c 'git push'", 'git.push'],
    ["bash --norc -c 'git push'", 'git.push'],
    ["bash -o pipefail -c 'git push'", 'git.push'],
    ["bash -c 'echo hi; git push origin main'", 'git.push'],
    ["bash -c \"bash -c 'git push origin main'\"", 'git.push'],
    ['bash -c "eval \\"git push\\""', 'git.push'],
    ["sudo timeout 5 bash -c 'git push'", 'git.push'],
    ['bash -c "echo $(git push)"', 'git.push'],
    ["bash -c 'echo $(npm publish)'", 'release.publish'],
    ['bash -c "git push origin $BRANCH"', 'git.push'],
  ];
  for (const [line, action] of FORMS) {
    it(`${JSON.stringify(line)} is ${action}`, () => {
      assert.deepEqual(actionsOf(line).slice(0, 1), [action]);
    });
  }

  it('names every command of a shell string, in order', () => {
    assert.deepEqual(actionsOf("bash -c 'git push a; npm publish'"), ['git.push', 'release.publish']);
  });

  it('takes the target of the inner command, and carries the outer assignments on it', () => {
    const inner = firstOf("FOO=1 bash -c 'git push origin main'");
    assert.equal(inner.params['remote'], 'origin');
    assert.equal(inner.params['refspec'], 'main');
    assert.equal(inner.params['env'], 'FOO=1');
    assert.equal(firstOf("bash -c 'BAR=2 git push origin main'").params['env'], 'BAR=2');
    assert.equal(firstOf("FOO=1 bash -c 'BAR=2 git push origin main'").params['env'], 'FOO=1 BAR=2');
  });

  it('keeps the whole outer line in the digest of the inner command', () => {
    const text = "bash -c 'git push origin main'";
    assert.equal(firstOf(text).params['line'], lineDigest(text));
  });

  it('a computed string stays unclassified, while the commands of its substitution are still read', () => {
    assert.deepEqual(classifyLine('bash -c "$X"'), { kind: 'none' });
    assert.deepEqual(classifyLine('sh -c "$(cat f)"'), { kind: 'none' });
    assert.deepEqual(classifyLine('eval "$CMD"'), { kind: 'none' });
    assert.deepEqual(actionsOf('sh -c "$(git push)"'), ['git.push']);
  });

  it('a shell that is not given a string, or a script, is not read as holding a push', () => {
    for (const line of ['bash script.sh git push', 'bash -x script.sh', 'sh', 'bash -c', 'eval', 'timeout', 'flock /tmp/l', 'xargs', 'bash -c "echo git push"', "eval 'echo git push'"]) {
      assert.deepEqual(classifyLine(line), { kind: 'none' }, line);
    }
  });

  it('a shell string that cannot be read is unparseable, never none', () => {
    assert.equal(classifyLine('bash -c \'echo "unterminated\'').kind, 'unparseable');
    assert.equal(classifyLine("eval 'echo $(git status'").kind, 'unparseable');
  });

  it('shell strings nested more than the scanner reads are unparseable', () => {
    let line = 'git push';
    for (let level = 0; level < 12; level += 1) line = `bash -c ${JSON.stringify(line)}`;
    assert.equal(classifyLine(line).kind, 'unparseable');
  });
});

describe('npm publish is found after any option, and only as the subcommand (WR-03, T-04-137)', () => {
  const published = (line: string): boolean => actionsOf(line).includes('release.publish');

  it('classifies publish after an option npm takes a value for', () => {
    for (const line of ['npm --scope @x publish', 'npm --fetch-retries 3 publish', 'npm --cwd pkg publish', 'npm --loglevel info publish', 'npm --prefix test publish', 'npm -w pkg publish', 'npm --registry https://r.example publish', 'npm --scope=@x publish']) {
      assert.ok(published(line), line);
    }
  });

  it("classifies npm's own abbreviations of publish", () => {
    for (const line of ['npm pub', 'npm publi', 'npm pu']) assert.ok(published(line), line);
  });

  it('does not name a command that has the word publish as an argument', () => {
    for (const line of ['npm install publish', 'npm view publish', 'npm i publish', 'npm info publish', 'npm run publish', 'npm test publish', 'npm --scope @x install publish']) {
      assert.ok(!published(line), line);
    }
  });

  it('exports the table of npm command names and aliases', () => {
    for (const name of ['publish', 'install', 'view', 'i', 'info', 'run', 'run-script', 'unpublish']) assert.ok(Object.hasOwn(NPM_COMMANDS, name), name);
    assert.equal(NPM_COMMANDS['info'], 'view');
    assert.equal(NPM_COMMANDS['publish'], 'publish');
  });

  it('drops the subcommand and the option values before it from the parameters, by position', () => {
    assert.equal(firstOf('npm --scope @x publish').params['package'], undefined);
    assert.equal(firstOf('npm --scope @x publish ./pkg.tgz').params['package'], './pkg.tgz');
    assert.equal(firstOf('npm publish publish').params['package'], 'publish', 'a package named publish is a package');
  });
});

describe('gh api forms whose body cannot be bound are marked unapprovable (WR-04, T-04-138)', () => {
  const reasonOf = (line: string): string | undefined => {
    const found = classifyLine(line);
    return found.kind === 'privileged' ? found.commands[0]?.unapprovable : undefined;
  };

  it('exports the rule name', () => {
    assert.equal(UNAPPROVABLE_RULE, 'privileged:unapprovable');
  });

  it('marks --input and a -F or --field value that starts with @, with a reason that names the file or standard input', () => {
    for (const line of ['gh api graphql -F query=@q.graphql', 'gh api repos/o/r/issues --input body.json', 'gh api repos/o/r/issues --input=body.json', 'gh api repos/o/r/issues -F body=@-', 'gh api repos/o/r/issues --field body=@b.txt', 'gh api repos/o/r/issues -Fbody=@b.txt', 'gh api repos/o/r/issues --field=body=@b.txt', 'gh api -X PATCH repos/o/r --input -']) {
      assert.match(reasonOf(line) ?? '', /file or standard input/, line);
    }
  });

  it('does not mark inline fields, a raw field that starts with @, or a read', () => {
    for (const line of ["gh api graphql -f query='mutation { a }'", 'gh api repos/o/r/issues -F title=x', 'gh api repos/o/r/issues -f body=@literal', 'gh api repos/o/r/issues -X POST -H "X: @y"', 'gh api repos/o/r/pulls -X POST']) {
      assert.equal(reasonOf(line), undefined, line);
    }
  });

  it('a body from a file on a GET is no privileged command at all', () => {
    assert.deepEqual(classifyLine('gh api -X GET repos/o/r --input body.json'), { kind: 'none' });
  });

  it('inline queries that differ only in a value the old binding dropped have different digests (line)', () => {
    assert.notDeepEqual(firstOf("gh api graphql -f query='mutation { a }'").params, firstOf("gh api graphql -f query='mutation { b }'").params);
  });

  it('classifies the unapprovable form as the same action, so a run still denies it as privileged:scm.api.write', () => {
    assert.equal(firstOf('gh api graphql -F query=@q.graphql').action, 'scm.api.write');
  });
});

describe('a gh option between the group and the subcommand does not hide the subcommand (GWR-01, FR-12, T-04-150)', () => {
  const noLine = (params: Record<string, string>): Record<string, string> => {
    const { line: _line, ...rest } = params;
    return rest;
  };

  it('classifies the subcommand and binds the repository, whichever way the option is written', () => {
    const cases: ReadonlyArray<readonly [string, string, string]> = [
      ['gh pr -R x/y create', 'scm.pr.create', 'x/y'],
      ['gh pr --repo=x/y merge 1', 'scm.pr.merge', 'x/y'],
      ['gh release -R x create v1', 'release.publish', 'x'],
      ['gh pr -Rx/y edit 3', 'scm.pr.update', 'x/y'],
      ['gh pr --repo x/y create', 'scm.pr.create', 'x/y'],
      ['gh pr --some-flag -R x/y create', 'scm.pr.create', 'x/y'],
    ];
    for (const [line, action, repo] of cases) {
      const one = firstOf(line);
      assert.equal(one.action, action, line);
      assert.equal(one.params['repo'], repo, line);
    }
  });

  it('binds the same parameters whether the option comes before or after the subcommand, apart from the line digest', () => {
    const before = firstOf('gh pr -R x/y create --base main');
    const after = firstOf('gh pr create -R x/y --base main');
    assert.deepEqual(noLine(before.params), noLine(after.params));
    assert.equal(before.params['base'], 'main');
    assert.equal(before.params['repo'], 'x/y');
  });

  it('leaves the non-privileged subcommands and an option with no subcommand as none', () => {
    for (const line of ['gh pr -R x/y list', 'gh pr --repo x/y view 3', 'gh pr -R', 'gh pr', 'gh pr -R x/y']) {
      assert.deepEqual(classifyLine(line), { kind: 'none' }, line);
    }
  });

  it('still reads gh api as before', () => {
    assert.equal(firstOf('gh api repos/o/r/pulls -X POST').action, 'scm.api.write');
    assert.deepEqual(classifyLine('gh api repos/o/r/pulls'), { kind: 'none' });
  });
});

describe('a git alias or config include defined on the same line is refused as unparseable (GWR-03, FR-12, T-04-151)', () => {
  const UNPARSEABLE_ALIAS: readonly string[] = [
    'git -c alias.p=push p origin main',
    "git -c Alias.P='!git push' p",
    'git --config-env=alias.p=VAR p',
    'git --config-env alias.p=VAR p',
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.p GIT_CONFIG_VALUE_0=push git p',
    'env GIT_CONFIG_KEY_0=alias.p GIT_CONFIG_VALUE_0=push GIT_CONFIG_COUNT=1 git p',
    `GIT_CONFIG_PARAMETERS="'alias.p'='push'" git p`,
    'git -c include.path=/tmp/x p',
    'git -c includeIf.gitdir:/x.path=/tmp/x p',
    'git -c alias.p=push status',
  ];
  for (const line of UNPARSEABLE_ALIAS) {
    it(`${JSON.stringify(line)} is unparseable, with a reason that names the alias or include`, () => {
      const found = classifyLine(line);
      assert.equal(found.kind, 'unparseable');
      if (found.kind === 'unparseable') assert.match(found.reason, /git alias or a config include/);
    });
  }

  it('refuses the same forms inside a shell string, after env, and when an outer assignment reaches the inner command', () => {
    for (const line of ["bash -c 'git -c alias.p=push p origin main'", "env bash -c 'git -c alias.p=push p'", "bash -c 'GIT_CONFIG_KEY_0=alias.p git p'", "GIT_CONFIG_KEY_0=alias.p bash -c 'git p'", 'sudo git -c alias.p=push p']) {
      assert.equal(classifyLine(line).kind, 'unparseable', line);
    }
  });

  it('refuses a same-line alias in a later command of the line, not only the first', () => {
    assert.equal(classifyLine('echo hi; git -c alias.p=push p').kind, 'unparseable');
  });

  it('leaves the other config keys alone: an unrelated -c is none or a push with gitOptions bound', () => {
    assert.deepEqual(classifyLine('git -c core.editor=vi status'), { kind: 'none' });
    assert.equal(firstOf('git -c remote.origin.url=x push origin main').action, 'git.push');
    assert.equal(firstOf('git -c remote.origin.url=x push origin main').params['gitOptions'], '-c remote.origin.url=x');
    assert.equal(firstOf('git -c aliasx.y=1 push origin main').action, 'git.push', 'a key that only starts with the letters alias');
    assert.equal(firstOf('GIT_CONFIG_KEY_0=core.pager GIT_CONFIG_VALUE_0=cat GIT_CONFIG_COUNT=1 git push origin main').action, 'git.push');
    assert.equal(firstOf('git push origin main').action, 'git.push');
  });

  it('classifyShellCommand answers unparseable for the same one-command form', () => {
    const found = classifyShellCommand(['git', '-c', 'alias.p=push', 'p']);
    assert.ok(found !== null && isUnparseable(found));
  });
});

describe('an unquoted here-document body yields each substitution once (GIN-01, FR-12, T-04-152)', () => {
  const pushesOf = (line: string): number => actionsOf(line).filter((action) => action === 'git.push').length;

  it('counts one push for a $(...) body line, a body line with an apostrophe before it, and backticks', () => {
    assert.equal(pushesOf('cat <<EOF >out\n$(git push)\nEOF'), 1);
    assert.equal(pushesOf("cat <<EOF >out\nit's $(git push)\nEOF"), 1);
    assert.equal(pushesOf('cat <<EOF >out\n`git push`\nEOF'), 1);
    assert.equal(pushesOf('cat <<EOF\n$(git push)\nEOF'), 1);
  });

  it('counts one push for a quoted delimiter, which the tolerant command scan finds', () => {
    assert.equal(pushesOf("cat <<'EOF' >out\n$(git push)\nEOF"), 1);
  });

  it('counts two commands for two different substitutions in one body', () => {
    assert.deepEqual(actionsOf('cat <<EOF\n$(git push a)\n$(npm publish)\nEOF'), ['git.push', 'release.publish']);
    assert.equal(pushesOf('cat <<EOF\n$(git push a) and $(git push b)\nEOF'), 2);
  });

  it('counts a nested push inside a substitution once', () => {
    assert.equal(pushesOf('cat <<EOF\n$(echo $(git push))\nEOF'), 1);
  });

  it('keeps the results of the existing here-document cases', () => {
    assert.deepEqual(classifyLine(COMMIT_WITH_HEREDOC), { kind: 'none' });
    assert.deepEqual(classifyLine("cat <<'EOF'\nit's prose, with (parens)\nEOF"), { kind: 'none' });
    assert.deepEqual(actionsOf("bash <<'EOF'\ngit push\nEOF"), ['git.push']);
  });
});

describe('a brace expansion or a glob that decides which command runs is refused as unparseable (GWR-02, FR-12, T-04-163)', () => {
  const refused = (line: string): void => {
    const found = classifyLine(line);
    assert.equal(found.kind, 'unparseable', line);
    if (found.kind === 'unparseable') assert.match(found.reason, /brace expansion or a glob/, line);
  };

  it('refuses a brace or a glob in the program, the subcommand or a global option of a git command', () => {
    for (const line of ['git pus{h,}', '{git,push} origin main', 'g{i,}t push', 'git pu?h', 'git -C dir* push', 'git p[u]sh', 'git -c core.x={a,b} push', 'git {push,pull} origin', 'FOO={a,b} git push', 'env {a,b}=1 git push']) refused(line);
  });

  it('refuses a brace or a glob in a word before the program, whatever the command after it', () => {
    for (const line of ['echo ok; {git,push} origin main', 'time {git,x} push', 'nohup g*t push', 'timeout 5* git push', 'sudo -u {a,b} git push', 'xargs -n {1,2} git push', "bash -c 'git pus{h,}'", 'eval git pus{h,}', 'echo $(git pus{h,})']) refused(line);
  });

  it('refuses a brace or a glob in the group, an option before the subcommand, or the subcommand of gh', () => {
    for (const line of ['gh pr cre{ate,}', 'gh {pr,issue} create', 'gh pr -R {a,b}/y create', 'gh pr crea* --title x', 'gh a?i repos/o/r/issues -X POST', 'gh p* create']) refused(line);
  });

  it('refuses a brace or a glob in the words npm reads up to its subcommand, and in any word when it has none', () => {
    for (const line of ['npm pub{lish,}', 'npm publis?', 'npm --scope {a,b} publish', 'npm p*', 'npm --x*']) refused(line);
  });

  it('refuses a brace expansion anywhere in a privileged command, because the bound parameters would not be the words that run', () => {
    for (const line of ['git push origin {main,dev}', 'git push origin HEAD:refs/heads/{a,b}', 'git push {origin,fork} main', 'git push origin {1..3}', 'gh pr create --base {main,dev}', 'gh api repos/o/r/issues -X POST -f title={a,b}', 'npm publish --tag {a,b}', 'npm publish {a,b}']) refused(line);
  });

  it('refuses a line when the refused word is in a later command or in a substitution', () => {
    refused('echo hi; git push origin {a,b}');
    refused('echo "$(git push origin {a,b})"');
  });

  it('keeps the answers of lines that only look like expansions', () => {
    for (const line of ['mkdir -p src/{a,b}', 'git add src/{a,b}.ts', '[ -f x ] && echo ok', 'gh api repos/{owner}/{repo}/issues', 'echo {a,b}', 'echo *.ts', 'ls src/*.ts | wc -l', 'git status *', 'git diff HEAD~{1,2}', 'git log --since=?', 'echo $? $* $@ $#', 'echo ${A:-a,b} ${B#*/}', '[[ -f x ]] && echo ok', 'gh pr list --label x*', 'npm run build:*', 'npm test -- src/**/*.ts', 'git commit -m "fix {a,b} * ?"', "echo '{a,b}' \\{c,d\\}", 'for f in *.ts; do echo $f; done', 'case x in a) echo 1;; *) echo 2;; esac']) {
      assert.deepEqual(classifyLine(line), { kind: 'none' }, line);
    }
  });

  it('keeps a push whose words hold no brace expansion, a glob after the subcommand included, and binds the glob as written', () => {
    assert.deepEqual(actionsOf('git push origin main'), ['git.push']);
    assert.deepEqual(actionsOf('git push origin "{a,b}"'), ['git.push']);
    assert.deepEqual(actionsOf("git push origin '{a,b}' \\{c,d\\}"), ['git.push']);
    assert.deepEqual(actionsOf('git push origin ${BRANCH:-a,b}'), ['git.push']);
    assert.deepEqual(actionsOf('git push origin refs/heads/*'), ['git.push']);
    assert.equal(firstOf('git push origin refs/heads/*').params['refspec'], 'refs/heads/*');
    assert.deepEqual(actionsOf('git push origin ma?n'), ['git.push']);
    assert.deepEqual(actionsOf('git push origin [ab]'), ['git.push']);
    assert.deepEqual(actionsOf('gh pr create --title "x" --base ma*'), ['scm.pr.create']);
    assert.deepEqual(actionsOf('gh api repos/{owner}/{repo}/pulls -X POST'), ['scm.api.write']);
    assert.deepEqual(actionsOf('npm publish dist/*.tgz'), ['release.publish']);
  });

  it('does not read a quoted, escaped, parameter or special-parameter character as an expansion', () => {
    for (const line of ["git 'pus{h,}' origin", 'git "pu?h"', 'git pus\\{h,\\}', 'git pu\\?h', 'git ${A:-a,b}', 'git $*', 'git $? push']) {
      assert.notEqual(classifyLine(line).kind, 'unparseable', line);
    }
  });

  it('classifyShellCommand, given words without expansion marks, still names a push', () => {
    const found = classifyShellCommand(['git', 'push', 'origin', 'main']);
    assert.ok(found !== null && !isUnparseable(found) && found.action === 'git.push');
    assert.equal(classifyShellCommand(['git', 'status']), null);
  });
});

describe('a push started through a wrapper or launcher is seen (GIN-02, FR-12, T-04-164)', () => {
  const FORMS: ReadonlyArray<readonly [string, string]> = [
    ['find . -maxdepth 0 -exec git push \\;', 'git.push'],
    ["find . -maxdepth 0 -exec git push ';'", 'git.push'],
    ['find . -maxdepth 0 -execdir git push {} +', 'git.push'],
    ['find . -maxdepth 0 -ok git push {} \\;', 'git.push'],
    ['find . -maxdepth 0 -okdir git push \\;', 'git.push'],
    ['find . -name x -exec echo {} \\; -exec git push \\;', 'git.push'],
    ["find . -exec sh -c 'git push' _ {} \\;", 'git.push'],
    ['sudo find . -exec git push \\;', 'git.push'],
    ['parallel git push ::: a', 'git.push'],
    ['parallel -j 4 git push ::: a b', 'git.push'],
    ['parallel git push {} ::: a', 'git.push'],
    ['parallel git ::: push', 'git.push'],
    ["parallel ::: 'git push'", 'git.push'],
    ["parallel 'git push' ::: a", 'git.push'],
    ['watch git push', 'git.push'],
    ['watch -n 5 git push', 'git.push'],
    ["watch 'git push'", 'git.push'],
    ['watch -x git push', 'git.push'],
    ['watch --exec git push', 'git.push'],
    ['watch -n5 -x git push', 'git.push'],
    ['doas git push', 'git.push'],
    ['doas -u root git push', 'git.push'],
    ['taskset 1 git push', 'git.push'],
    ['taskset 0x3 git push', 'git.push'],
    ['taskset -c 0 git push', 'git.push'],
    ['taskset --cpu-list 0,1 git push', 'git.push'],
    ['arch -arm64 git push', 'git.push'],
    ['arch -x86_64 git push', 'git.push'],
    ['arch -arch arm64 git push', 'git.push'],
    ['arch -e A=1 -d B git push', 'git.push'],
    ['caffeinate git push', 'git.push'],
    ['caffeinate -t 60 -i git push', 'git.push'],
    ['caffeinate -w 12 git push', 'git.push'],
    ['unbuffer git push', 'git.push'],
    ['unbuffer -p git push', 'git.push'],
    ['chronic git push', 'git.push'],
    ['chronic -e git push', 'git.push'],
    ['coproc git push', 'git.push'],
    ['coproc git push; wait', 'git.push'],
    ['doas taskset 1 caffeinate gh pr create', 'scm.pr.create'],
    ['find . -exec npm publish \\;', 'release.publish'],
  ];
  for (const [line, action] of FORMS) {
    it(`${JSON.stringify(line)} is ${action}`, () => {
      assert.deepEqual(actionsOf(line).slice(0, 1), [action]);
    });
  }

  it('names one push for each command a find -exec runs, and one for each argument of parallel', () => {
    assert.deepEqual(actionsOf('find . -exec git push \\; -exec npm publish \\;'), ['git.push', 'release.publish']);
    assert.deepEqual(actionsOf('parallel git push ::: a b'), ['git.push', 'git.push']);
    assert.deepEqual(actionsOf('parallel git push'), ['git.push']);
  });

  it('binds the target of the command a wrapper runs, and carries the assignments before the wrapper', () => {
    const pushed = firstOf('FOO=1 doas -u root git push origin main');
    assert.equal(pushed.params['remote'], 'origin');
    assert.equal(pushed.params['refspec'], 'main');
    assert.equal(pushed.params['env'], 'FOO=1');
    assert.equal(firstOf('BAR=2 taskset 1 git push').params['env'], 'BAR=2');
    assert.equal(firstOf('FOO=1 find . -exec git push origin main \\;').params['env'], 'FOO=1');
    assert.equal(firstOf('parallel git push {} ::: a').params['remote'], 'a');
  });

  it('answers none for a form that runs nothing, or runs a program that is not privileged', () => {
    for (const line of ['taskset -p 1234', 'taskset -pc 0 1234', 'taskset --pid 1234', "find . -name '*.ts'", 'find . -type f -print', 'find . -exec echo {} \\;', 'watch ls', 'watch -n 1', 'parallel echo ::: a b', 'parallel ::: ls', 'doas', 'arch', 'caffeinate', 'unbuffer', 'chronic', 'coproc', 'coproc ls', 'taskset 1']) {
      assert.deepEqual(classifyLine(line), { kind: 'none' }, line);
    }
  });

  it('keeps the prefix limit with the new wrappers: 16 classify and 17 are unparseable', () => {
    for (const wrapper of ['doas', 'caffeinate', 'unbuffer', 'chronic', 'taskset 1', 'arch -arm64', 'coproc']) {
      assert.deepEqual(actionsOf(`${`${wrapper} `.repeat(16)}git push`), ['git.push'], wrapper);
      assert.equal(classifyLine(`${`${wrapper} `.repeat(17)}git push`).kind, 'unparseable', wrapper);
    }
  });

  it('refuses a brace or a glob in the words each new reader consumes before the command it runs', () => {
    for (const line of ['doas -u {a,b} git push', 'taskset {1,2} git push', 'taskset -c 0* git push', 'arch -{a,b} git push', 'caffeinate -t {1,2} git push', 'find . -exec git pus{h,} \\;', 'find . -exec g*t push \\;', 'watch -n {1,2} git push', 'watch -x git pu?h', 'parallel -j {1,2} git push ::: a', 'parallel git pus{h,} ::: a', 'watch git pus{h,}']) {
      assert.equal(classifyLine(line).kind, 'unparseable', line);
    }
  });
});

describe('a shell string in su and trap, and a here-string given to a shell, are read as shell input (GIN-02, FR-12, T-04-164)', () => {
  const FORMS: ReadonlyArray<readonly [string, string]> = [
    ["su -c 'git push'", 'git.push'],
    ["su - me -c 'git push'", 'git.push'],
    ["su --command='git push'", 'git.push'],
    ["su -l me -c 'git push'", 'git.push'],
    ["su -s /bin/sh me -c 'git push'", 'git.push'],
    ["su -lc 'git push' me", 'git.push'],
    ["su me --command 'git push'", 'git.push'],
    ["sudo su -c 'npm publish'", 'release.publish'],
    ["trap 'git push' EXIT", 'git.push'],
    ["trap -- 'git push' INT TERM", 'git.push'],
    ["trap 'echo x; git push' EXIT", 'git.push'],
    ['bash <<< \'git push\'', 'git.push'],
    ['sh <<<"git push"', 'git.push'],
    ["zsh <<< 'git push'", 'git.push'],
    ["sudo bash <<< 'git push'", 'git.push'],
    ["env bash <<< 'git push'", 'git.push'],
    ["bash -s <<< 'git push'", 'git.push'],
    ["bash -s arg <<< 'git push'", 'git.push'],
    ["bash - <<< 'git push'", 'git.push'],
    ["<<< 'git push' bash", 'git.push'],
    ["bash <<< 'echo a; git push'", 'git.push'],
    ["bash <<< 'npm publish'", 'release.publish'],
  ];
  for (const [line, action] of FORMS) {
    it(`${JSON.stringify(line)} is ${action}`, () => {
      assert.deepEqual(actionsOf(line).slice(0, 1), [action]);
    });
  }

  it('answers none when the string or the input is not a push, or the shell does not read the input as commands', () => {
    for (const line of [
      'trap EXIT',
      'trap - INT',
      'trap -p',
      'trap -l',
      'trap',
      'trap 0 EXIT',
      'su',
      'su -l me',
      'su - me',
      "su -s /bin/sh me",
      "su -c 'echo hi'",
      "bash -c true <<< 'git push'",
      "bash script.sh <<< 'git push'",
      "bash -x script.sh <<< 'git push'",
      "bash <<< 'echo hi'",
      'bash <<< "$X"',
      "cat <<< 'git push'",
      "echo x <<< 'git push'",
      "eval true <<< 'git push'",
      "git status <<< 'git push'",
    ]) {
      assert.deepEqual(classifyLine(line), { kind: 'none' }, line);
    }
  });

  it('binds the target of the inner command, the assignments before the shell, and the whole line', () => {
    const text = "FOO=1 bash <<< 'git push origin main'";
    const pushed = firstOf(text);
    assert.equal(pushed.params['remote'], 'origin');
    assert.equal(pushed.params['refspec'], 'main');
    assert.equal(pushed.params['env'], 'FOO=1');
    assert.equal(pushed.params['line'], lineDigest(text));
    assert.equal(firstOf("su -c 'git push origin dev'").params['refspec'], 'dev');
    assert.equal(firstOf("trap 'git push origin dev' EXIT").params['refspec'], 'dev');
  });

  it('names a here-string that holds a command substitution once', () => {
    assert.deepEqual(actionsOf('bash <<< "$(git push)"'), ['git.push']);
  });

  it('a here-string or a string that cannot be read is unparseable, never none', () => {
    assert.equal(classifyLine("bash <<< 'echo \"x'").kind, 'unparseable');
    assert.equal(classifyLine("su -c 'echo \"x'").kind, 'unparseable');
    assert.equal(classifyLine("trap 'echo \"x' EXIT").kind, 'unparseable');
  });

  it('refuses a brace or a glob that can form the option, or is the string, the reader looks for', () => {
    for (const line of ["su {-c,} 'git push'", "su -{c,x} 'git push'", "su -c {'git push',x}", "su -c g*t", "trap {'git push',x} EXIT", "trap 'git pus{h,}' EXIT", "su -c 'git pus{h,}'"]) {
      assert.equal(classifyLine(line).kind, 'unparseable', line);
    }
  });

  it('keeps a here-string into a shell nested in a shell string, within the nesting limit', () => {
    assert.deepEqual(actionsOf("bash -c \"bash <<< 'git push'\""), ['git.push']);
    assert.deepEqual(actionsOf("su -c \"su -c 'git push'\""), ['git.push']);
  });
});
