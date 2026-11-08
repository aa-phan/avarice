// The command-line history of the interactive shell (ADR-013 decision 2): `{dataRoot}/shell-history`, one entry per line, oldest first, created with
// mode 0600 (a command line can name a brief or a run ID; T-02-63), capped at HISTORY_CAP lines with the oldest dropped. An entry is stored without
// any control character, so a pasted escape sequence can neither forge a line nor rewrite the terminal when it is recalled. History is a
// convenience: a missing, unreadable or unwritable file is an empty history or a skipped entry, never an error that stops the shell.
import { chmodSync, closeSync, openSync, readFileSync, renameSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { stripControl } from '../render/style.ts';

export const HISTORY_FILE = 'shell-history';
export const HISTORY_CAP = 1000;

const CONTROL = /[\x00-\x1f\x7f-\x9f]/g;

// An entry as it is stored: escape sequences and every control character removed (including a line break), the ends trimmed. Empty when nothing is left.
export function historyEntry(text: string): string {
  return stripControl(text).replace(CONTROL, '').trim();
}

function linesOf(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '');
}

// The entries, oldest first (the order of the file). An empty list when the file is missing or cannot be read.
export function loadHistory(dataRoot: string): string[] {
  try {
    const lines = linesOf(join(dataRoot, HISTORY_FILE));
    return lines.length > HISTORY_CAP ? lines.slice(lines.length - HISTORY_CAP) : lines;
  } catch {
    return [];
  }
}

// Adds one entry at the end. Returns false when the file could not be written; an entry that is empty after cleaning is skipped and counts as done.
// At the cap the file is rewritten without its oldest lines through a temporary file in the same directory, so a crash leaves the old file or the new one.
export function appendHistory(dataRoot: string, entry: string): boolean {
  const clean = historyEntry(entry);
  if (clean === '') return true;
  const path = join(dataRoot, HISTORY_FILE);
  try {
    let existing: string[] = [];
    try {
      existing = linesOf(path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    if (existing.length + 1 > HISTORY_CAP) {
      const kept = [...existing.slice(existing.length - (HISTORY_CAP - 1)), clean];
      const temporary = `${path}.${process.pid}.tmp`;
      writeFileSync(temporary, `${kept.join('\n')}\n`, { mode: 0o600 });
      chmodSync(temporary, 0o600);
      renameSync(temporary, path);
      return true;
    }
    const fd = openSync(path, 'a', 0o600);
    try {
      writeSync(fd, `${clean}\n`);
    } finally {
      closeSync(fd);
    }
    // The mode given to open() applies only to a file it creates; a file that already existed is tightened too.
    chmodSync(path, 0o600);
    return true;
  } catch {
    return false;
  }
}
