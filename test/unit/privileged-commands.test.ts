// The privileged-command line classifier (plan 04-40; FR-12, CR-01, CR-02, WR-01, WR-02; threats T-04-105, T-04-106). classifyLine answers one of three things about a
// shell line: nothing privileged, the privileged commands it holds, or "could not be read". An unreadable line is never an answer of "nothing privileged".
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyLine, classifyShellCommand } from '../../src/domain/privileged-commands.ts';
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

it('reads a line of 65,536 quotes, parentheses and dollar signs in under 200 ms', () => {
  const unit = '"($)"\'$()\'';
  const line = unit.repeat(Math.ceil(65_536 / unit.length)).slice(0, 65_536);
  assert.equal(line.length, 65_536);
  const started = performance.now();
  const found = classifyLine(line);
  const ms = performance.now() - started;
  assert.ok(ms < 200, `took ${ms.toFixed(1)} ms`);
  assert.notEqual(found.kind, 'privileged');
});

// ---------------------------------------------------------------------------------------------------------
// The differential oracle (T-04-106): bash itself, and zsh where it is installed, run each line with stub git, gh and npm; every privileged invocation the shell
// performs is one classifyLine returned. `runs` is how many privileged invocations bash performs, so a stub that fails to run cannot make the test pass by doing nothing.
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
          .map((argv) => classifyShellCommand(argv))
          .filter((found) => found !== null);
        if (shell === 'bash') assert.equal(performed.length, runs, `bash performed ${performed.length} privileged commands, expected ${runs}: ${JSON.stringify(line)}`);
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
