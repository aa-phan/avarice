// Builds a runnable fake `claude` for one test: a shell wrapper that runs test/fixtures/claude-fake/claude-replay.mjs
// with a script, and the directory where the fake logs what it was launched with. Nothing here calls a model.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TranscriptName } from '../fixtures/stream-json.ts';
import { REPO_ROOT } from './run-cli.ts';

export const REPLAY = join(REPO_ROOT, 'test', 'fixtures', 'claude-fake', 'claude-replay.mjs');

export interface FakeClaudeScript {
  version?: string;
  transcript?: TranscriptName | null;
  mapFiles?: 'all' | 'fast' | readonly string[];
  stamp?: string | false;
  writes?: Readonly<Record<string, string>>;
  extraLines?: readonly string[];
  sleepMs?: number;
  sleepFirstOnly?: boolean;
  chunkBytes?: number;
  exitCode?: number;
  ignoreSigterm?: boolean;
  background?: boolean;
  commit?: boolean;
}

export interface Launch {
  pid: number;
  sessionId: string;
}

export interface LoggedArgv {
  argv: string[];
  cwd: string;
  pid: number;
}

export interface FakeClaude {
  // The executable to hand to the adapter (AVARICE_CLAUDE_BIN).
  bin: string;
  dir: string;
  // Present once a `-p` launch started (the `started` marker).
  startedMarker: string;
  started(): boolean;
  launches(): Launch[];
  argvs(): LoggedArgv[];
  // The environment of each launch.
  envs(): Array<Record<string, string>>;
  // Pids of the background processes the fake started in its group.
  children(): number[];
}

const lines = (path: string): string[] => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter((l) => l !== '') : []);

export function makeFakeClaude(script: FakeClaudeScript = {}, parent?: string): FakeClaude {
  const dir = realpathSync(mkdtempSync(join(parent ?? tmpdir(), 'avarice-fake-claude-')));
  const logs = join(dir, 'logs');
  mkdirSync(logs, { recursive: true });
  const scriptFile = join(dir, 'script.json');
  writeFileSync(scriptFile, JSON.stringify(script));
  const bin = join(dir, 'claude');
  const quoted = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`;
  writeFileSync(bin, `#!/bin/sh\nFAKE_CLAUDE_SCRIPT=${quoted(scriptFile)} FAKE_CLAUDE_DIR=${quoted(logs)} exec ${quoted(process.execPath)} ${quoted(REPLAY)} "$@"\n`);
  chmodSync(bin, 0o755);
  return {
    bin,
    dir,
    startedMarker: join(logs, 'started'),
    started: () => existsSync(join(logs, 'started')),
    launches: () => lines(join(logs, 'started.log')).map((l) => JSON.parse(l) as Launch),
    argvs: () => lines(join(logs, 'argv.jsonl')).map((l) => JSON.parse(l) as LoggedArgv),
    envs: () => lines(join(logs, 'env.jsonl')).map((l) => JSON.parse(l) as Record<string, string>),
    children: () => lines(join(logs, 'children.log')).map(Number),
  };
}
