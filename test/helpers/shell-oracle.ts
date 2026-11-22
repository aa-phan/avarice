// A shell as the oracle for the privileged-command classifier (plan 04-40; T-04-106). runUnderShell runs one fixed test line under bash or zsh with stub programs
// for git, gh and npm on PATH and nothing else, inside a temporary directory, and returns what the stubs logged: one entry per invocation, the program name followed by
// its arguments. The stubs do nothing but log, so a line that pushes, opens a pull request or publishes only writes a line to a file in the temporary directory.
//
// Test input reaches the shell only as the -c argument of a child process with a minimal environment, standard input from /dev/null and a timeout. A few more stubs
// (env, nohup, cat, diff, bash) let the lines of the corpus run the way the shell would run them; none of them does more than the real one with these arguments.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type Shell = 'bash' | 'zsh';

export const SHELL_PATHS: Readonly<Record<Shell, string>> = { bash: '/bin/bash', zsh: '/bin/zsh' };

export const shellAvailable = (shell: Shell): boolean => existsSync(SHELL_PATHS[shell]);

const single = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`;

// The shell's own start-up flags: no profile or rc file, so nothing but the line runs.
const SHELL_FLAGS: Readonly<Record<Shell, readonly string[]>> = { bash: ['--noprofile', '--norc', '-c'], zsh: ['-f', '-c'] };

function stub(dir: string, name: string, body: string): void {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

export function runUnderShell(shell: Shell, line: string): string[][] {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-oracle-')));
  try {
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const log = join(root, 'log.jsonl');
    const logger = join(root, 'log.mjs');
    writeFileSync(logger, `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');\n`);
    for (const name of ['git', 'gh', 'npm']) stub(bin, name, `exec ${single(process.execPath)} ${single(logger)} ${name} "$@"`);
    stub(bin, 'env', 'while [ $# -gt 0 ]; do case "$1" in -i|-) shift;; --) shift; break;; *=*) export "$1"; shift;; *) break;; esac; done\nexec "$@"');
    stub(bin, 'nohup', 'exec "$@"');
    stub(bin, 'cat', 'exec /bin/cat "$@"');
    stub(bin, 'diff', '/bin/cat "$@" >/dev/null 2>&1\nexit 0');
    stub(bin, 'bash', `exec ${single(SHELL_PATHS.bash)} "$@"`);
    // Shells and wrappers (plan 04-51; WR-01): each does what the real one does with the arguments the corpus gives it, and runs the stub programs through PATH. None of the
    // wrappers is installed on every machine the suite runs on, so the oracle brings its own.
    stub(bin, 'sh', 'exec /bin/sh "$@"');
    stub(bin, 'timeout', 'while [ $# -gt 0 ]; do case "$1" in -s|-k) shift 2;; -*) shift;; *) break;; esac; done\nshift\nexec "$@"');
    stub(bin, 'xargs', 'exec "$@"');
    stub(bin, 'setsid', 'while [ $# -gt 0 ]; do case "$1" in -*) shift;; *) break;; esac; done\nexec "$@"');
    stub(bin, 'stdbuf', 'while [ $# -gt 0 ]; do case "$1" in -*) shift;; *) break;; esac; done\nexec "$@"');
    stub(bin, 'ionice', 'while [ $# -gt 0 ]; do case "$1" in -*) shift;; *) break;; esac; done\nexec "$@"');
    stub(bin, 'flock', 'cmd=\nwhile [ $# -gt 0 ]; do case "$1" in -c) cmd="$2"; shift 2;; -w|-E) shift 2;; -*) shift;; *) break;; esac; done\nshift\nwhile [ $# -gt 0 ]; do case "$1" in -c) cmd="$2"; shift 2;; *) break;; esac; done\nif [ -n "$cmd" ]; then exec /bin/sh -c "$cmd"; fi\nexec "$@"');
    spawnSync(SHELL_PATHS[shell], [...SHELL_FLAGS[shell], line], { cwd: root, env: { PATH: bin, HOME: root, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 });
    if (!existsSync(log)) return [];
    return readFileSync(log, 'utf8')
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => JSON.parse(l) as string[]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
