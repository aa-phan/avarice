// The host transcript as it is kept (SEC-3, D-14): every complete newline-terminated line is redacted as it arrives and the
// redacted bytes are counted against the cap, so a secret the cap would have split is never stored. The cap cuts at a line
// boundary: the first line that does not fit, redacted, ends the kept text and everything after it is dropped, then a truncation
// note is added. The parser reads the raw stream separately; this class decides only what may be stored.
import { StringDecoder } from 'node:string_decoder';

import type { Redactor } from '../../domain/redactor.ts';

export class TranscriptCollector {
  readonly #redactor: Redactor;
  readonly #cap: number;
  readonly #decoder = new StringDecoder('utf8');
  readonly #kept: string[] = [];
  #keptBytes = 0;
  #pending = '';
  #truncated = false;

  constructor(redactor: Redactor, capBytes: number) {
    this.#redactor = redactor;
    this.#cap = capBytes;
  }

  push(chunk: Uint8Array): void {
    if (this.#truncated) return;
    this.#feed(this.#decoder.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)));
  }

  // The redacted transcript, with the truncation note when the cap was reached.
  finish(): string {
    if (!this.#truncated) {
      this.#feed(this.#decoder.end());
      // A final line with no newline is a line like any other.
      if (this.#pending !== '' && !this.#truncated) this.#keep(this.#redactor.redact(this.#pending));
      this.#pending = '';
    }
    return this.#kept.join('') + (this.#truncated ? `\n[avarice: transcript truncated at ${this.#cap} bytes]\n` : '');
  }

  #feed(piece: string): void {
    let rest = piece;
    while (rest !== '' && !this.#truncated) {
      const newline = rest.indexOf('\n');
      if (newline === -1) {
        this.#pending += rest;
        // A line longer than the whole cap cannot fit once redacted unless it is almost all secret: it ends the transcript.
        if (this.#pending.length > this.#cap) this.#stop();
        return;
      }
      const line = this.#pending + rest.slice(0, newline);
      rest = rest.slice(newline + 1);
      this.#pending = '';
      this.#keep(`${this.#redactor.redact(line)}\n`);
    }
  }

  // Counts the redacted piece against the cap; a piece that does not fit ends the kept text.
  #keep(redacted: string): void {
    const bytes = Buffer.byteLength(redacted);
    if (this.#keptBytes + bytes > this.#cap) {
      this.#stop();
      return;
    }
    this.#kept.push(redacted);
    this.#keptBytes += bytes;
  }

  #stop(): void {
    this.#truncated = true;
    this.#pending = '';
  }
}
