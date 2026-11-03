// A fake `claude` binary for the host adapter tests: no model, no network, no spend (plan 01-15).
//
// `--version` answers `script.version` (default "2.1.316 (Claude Code)"). Any other launch (`-p ...`) behaves as the
// script says, in this order: touch the `started` marker and log the argv, the working directory and the names of the
// environment variables it was given; sleep `sleepMs`; write the files; replay the named stream-json transcript to
// stdout with the real session ID substituted; exit with `exitCode`.
//
// The script is JSON in the file named by FAKE_CLAUDE_SCRIPT (tests make a wrapper that sets it, because the host
// strips the environment it launches with), next to a directory FAKE_CLAUDE_DIR for the logs:
//   version          string    answer to --version
//   transcript       string    one of success, apiError, maxBudget, hookBlock (test/fixtures/stream-json.ts); null prints nothing
//   mapFiles         "all" | "fast" | string[]   map documents to write under .planning/codebase (names such as STACK.md); not on a
//                    launch that names an agent (`--agent`), which is the intel purpose
//   intel            boolean   on a launch of `--agent gsd-intel-updater`, write the five intel documents and the refresh snapshot
//                    (test/fixtures/index-fixtures.ts) under .planning/intel
//   stamp            string | false   last_mapped_commit for the documents (default: git HEAD of the working directory)
//   writes           { relPath: content }   other files to write, relative to the working directory
//   extraLines       string[]  raw lines printed before the transcript's result (for example text a secret scan must catch)
//   sleepMs          number    sleep before writing anything
//   sleepFirstOnly   boolean   sleep only on the first launch (the log says which launch this is)
//   chunkBytes       number    print stdout in pieces of this size, splitting lines
//   exitCode         number
//   ignoreSigterm    boolean   ignore SIGTERM, so only SIGKILL ends the process
//   background       boolean   start a `sleep 300` in the same process group and log its pid (children.log)
//   commit           boolean   make a commit in the working directory (moves HEAD)
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { transcript } from '../stream-json.ts';
import { fakeMapDocument } from '../../helpers/fake-agent-host.ts';
import { INTEL_FILE_NAMES, intelDocuments, refreshSnapshot, serializeIntel } from '../index-fixtures.ts';

const argv = process.argv.slice(2);
const scriptPath = process.env.FAKE_CLAUDE_SCRIPT;
const dir = process.env.FAKE_CLAUDE_DIR;
const script = scriptPath === undefined ? {} : JSON.parse(readFileSync(scriptPath, 'utf8'));

if (argv.includes('--version')) {
  process.stdout.write(`${script.version ?? '2.1.316 (Claude Code)'}\n`);
  process.exit(0);
}

if (script.ignoreSigterm === true) process.on('SIGTERM', () => {});

const flag = (name) => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};
const sessionId = flag('--session-id') ?? 'no-session';

let launch = 1;
if (dir !== undefined) {
  mkdirSync(dir, { recursive: true });
  closeSync(openSync(join(dir, 'started'), 'a'));
  appendFileSync(join(dir, 'started.log'), `${JSON.stringify({ pid: process.pid, sessionId })}\n`);
  launch = readFileSync(join(dir, 'started.log'), 'utf8').split('\n').filter((l) => l !== '').length;
  appendFileSync(join(dir, 'argv.jsonl'), `${JSON.stringify({ argv, cwd: process.cwd(), pid: process.pid })}\n`);
  appendFileSync(join(dir, 'env.jsonl'), `${JSON.stringify(process.env)}\n`);
}

if (script.background === true) {
  const child = spawn('sleep', ['300'], { stdio: 'ignore' });
  if (dir !== undefined) appendFileSync(join(dir, 'children.log'), `${child.pid}\n`);
}

if (script.sleepMs !== undefined && (script.sleepFirstOnly !== true || launch === 1)) await sleep(script.sleepMs);

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const writeFile = (rel, content) => {
  const target = join(process.cwd(), rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
};

if (flag('--agent') === undefined && script.mapFiles !== undefined) {
  const names =
    script.mapFiles === 'all'
      ? ['STACK.md', 'ARCHITECTURE.md', 'STRUCTURE.md', 'CONVENTIONS.md', 'TESTING.md', 'INTEGRATIONS.md', 'CONCERNS.md']
      : script.mapFiles === 'fast'
        ? ['STACK.md', 'INTEGRATIONS.md', 'ARCHITECTURE.md', 'STRUCTURE.md']
        : script.mapFiles;
  const stamp = script.stamp === undefined ? git('rev-parse', 'HEAD') : script.stamp;
  const tracked = git('ls-files').split('\n').filter((l) => l !== '');
  for (const name of names) writeFile(join('.planning', 'codebase', name), fakeMapDocument(name, stamp, tracked, undefined));
}
if (flag('--agent') === 'gsd-intel-updater' && script.intel === true) {
  const files = serializeIntel(intelDocuments());
  for (const name of INTEL_FILE_NAMES) writeFile(join('.planning', 'intel', name), files[name]);
  writeFile(join('.planning', 'intel', '.last-refresh.json'), refreshSnapshot(files));
}
for (const [rel, content] of Object.entries(script.writes ?? {})) writeFile(rel, content);
if (script.commit === true) git('-c', 'user.name=Fake', '-c', 'user.email=fake@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'moved by the fake host');

if (script.transcript !== undefined && script.transcript !== null) {
  const lines = transcript(script.transcript, sessionId).split('\n');
  const result = lines.findIndex((l) => l.startsWith('{"type":"result"'));
  const withExtra = [...lines.slice(0, result), ...(script.extraLines ?? []), ...lines.slice(result)].join('\n');
  if (script.chunkBytes === undefined) {
    process.stdout.write(withExtra);
  } else {
    for (let at = 0; at < withExtra.length; at += script.chunkBytes) {
      process.stdout.write(withExtra.slice(at, at + script.chunkBytes));
      await sleep(1);
    }
  }
}
process.exit(script.exitCode ?? 0);
