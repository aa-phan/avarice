// The command-line editor of the interactive shell (ADR-013 decision 2): a pure state machine over key presses, so the shell and its tests
// drive it the same way. It holds the text and the cursor and answers each key with `pending`, `submit` (Enter) or `cancel` (Escape, Ctrl-C,
// Ctrl-D on an empty line). It touches no stream; the shell draws `text` and `position` itself. Typed text passes through stripControl, so
// a control character or an escape sequence pasted into the line never reaches the buffer.
import { stripControl } from '../render/style.ts';

// The part of a readline `keypress` event the editor reads.
export interface KeyInput {
  name?: string | undefined;
  sequence?: string | undefined;
  ctrl?: boolean | undefined;
  meta?: boolean | undefined;
  shift?: boolean | undefined;
}

export type EditorResult = { kind: 'pending' } | { kind: 'submit'; line: string } | { kind: 'cancel' };

export interface LineEditorOptions {
  prompt: string;
  // Earlier entries, oldest first. Up recalls the newest first; down goes back toward the line being typed.
  history?: readonly string[];
  // The command names Tab completes (the first word of the line).
  commands?: readonly string[];
}

export interface Completion {
  // The whole line after completing.
  buffer: string;
  // The sorted command names that match, shown to the user when there is more than one.
  candidates: string[];
}

const PENDING: EditorResult = { kind: 'pending' };

function commonPrefix(words: readonly string[]): string {
  let prefix = words[0] ?? '';
  for (const word of words) while (!word.startsWith(prefix)) prefix = prefix.slice(0, -1);
  return prefix;
}

// Completes the first word of a line against the command names. One match completes it with a trailing space; several extend it to their common
// prefix and are returned sorted, for the caller to show. Nothing for an unknown prefix or once the line has a space (a second word).
export function completeCommand(buffer: string, commands: readonly string[]): Completion | undefined {
  if (/\s/.test(buffer)) return undefined;
  const matches = commands.filter((name) => name.startsWith(buffer)).sort();
  const only = matches[0];
  if (only === undefined) return undefined;
  if (matches.length === 1) return { buffer: `${only} `, candidates: matches };
  return { buffer: commonPrefix(matches), candidates: matches };
}

// Typed or pasted text without control characters, including the newline and tab that stripControl keeps.
export function printable(text: string): string {
  return stripControl(text).replace(/[\n\t]/g, '');
}

export class LineEditor {
  readonly prompt: string;
  private chars: string[] = [];
  private cursor = 0;
  private readonly history: readonly string[];
  private readonly commands: readonly string[];
  // Which history entry is on the line (an index into `history`), or -1 for the line the user was typing; that line is kept in `draft`.
  private recall = -1;
  private draft = '';
  private shown: readonly string[] = [];

  constructor(options: LineEditorOptions) {
    this.prompt = options.prompt;
    this.history = options.history ?? [];
    this.commands = options.commands ?? [];
  }

  get text(): string {
    return this.chars.join('');
  }

  // The matching command names after an ambiguous Tab, until the next key.
  get candidates(): readonly string[] {
    return this.shown;
  }

  private setText(text: string): void {
    this.chars = Array.from(text);
    this.cursor = this.chars.length;
  }

  private older(): void {
    if (this.history.length === 0) return;
    if (this.recall === -1) {
      this.draft = this.text;
      this.recall = this.history.length - 1;
    } else {
      this.recall = Math.max(0, this.recall - 1);
    }
    this.setText(this.history[this.recall] as string);
  }

  private newer(): void {
    if (this.recall === -1) return;
    this.recall += 1;
    if (this.recall >= this.history.length) {
      this.recall = -1;
      this.setText(this.draft);
    } else {
      this.setText(this.history[this.recall] as string);
    }
  }

  private complete(): void {
    if (this.commands.length === 0 || this.cursor !== this.chars.length) return;
    const completion = completeCommand(this.text, this.commands);
    if (completion === undefined) return;
    this.setText(completion.buffer);
    this.shown = completion.candidates.length > 1 ? completion.candidates : [];
  }

  // The cursor offset in characters from the start of the text.
  get position(): number {
    return this.cursor;
  }

  private insert(text: string): void {
    const added = Array.from(text);
    this.chars.splice(this.cursor, 0, ...added);
    this.cursor += added.length;
  }

  private killWord(): void {
    let start = this.cursor;
    while (start > 0 && this.chars[start - 1] === ' ') start -= 1;
    while (start > 0 && this.chars[start - 1] !== ' ') start -= 1;
    this.chars.splice(start, this.cursor - start);
    this.cursor = start;
  }

  handle(key: KeyInput): EditorResult {
    // The candidates of an ambiguous Tab stay only until the next key.
    if (!(key.name === 'tab' && key.ctrl !== true)) this.shown = [];
    if (key.ctrl === true) {
      switch (key.name) {
        case 'c':
          return { kind: 'cancel' };
        case 'd':
          if (this.chars.length === 0) return { kind: 'cancel' };
          this.chars.splice(this.cursor, 1);
          return PENDING;
        case 'a':
          this.cursor = 0;
          return PENDING;
        case 'e':
          this.cursor = this.chars.length;
          return PENDING;
        case 'u':
          this.chars.splice(0, this.cursor);
          this.cursor = 0;
          return PENDING;
        case 'k':
          this.chars.splice(this.cursor);
          return PENDING;
        case 'w':
          this.killWord();
          return PENDING;
        default:
          return PENDING;
      }
    }
    switch (key.name) {
      case 'return':
      case 'enter':
        return { kind: 'submit', line: this.text };
      case 'escape':
        return { kind: 'cancel' };
      case 'backspace':
        if (this.cursor > 0) {
          this.chars.splice(this.cursor - 1, 1);
          this.cursor -= 1;
        }
        return PENDING;
      case 'delete':
        this.chars.splice(this.cursor, 1);
        return PENDING;
      case 'left':
        this.cursor = Math.max(0, this.cursor - 1);
        return PENDING;
      case 'right':
        this.cursor = Math.min(this.chars.length, this.cursor + 1);
        return PENDING;
      case 'home':
        this.cursor = 0;
        return PENDING;
      case 'end':
        this.cursor = this.chars.length;
        return PENDING;
      case 'up':
        this.older();
        return PENDING;
      case 'down':
        this.newer();
        return PENDING;
      case 'tab':
        this.complete();
        return PENDING;
      default:
        break;
    }
    if (key.meta !== true && key.sequence !== undefined) this.insert(printable(key.sequence));
    return PENDING;
  }
}
