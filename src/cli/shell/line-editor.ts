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
}

const PENDING: EditorResult = { kind: 'pending' };

// Typed or pasted text without control characters, including the newline and tab that stripControl keeps.
export function printable(text: string): string {
  return stripControl(text).replace(/[\n\t]/g, '');
}

export class LineEditor {
  readonly prompt: string;
  private chars: string[] = [];
  private cursor = 0;

  constructor(options: LineEditorOptions) {
    this.prompt = options.prompt;
  }

  get text(): string {
    return this.chars.join('');
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
      default:
        break;
    }
    if (key.meta !== true && key.sequence !== undefined) this.insert(printable(key.sequence));
    return PENDING;
  }
}
