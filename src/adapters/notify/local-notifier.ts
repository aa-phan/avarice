// LocalNotifier: the macOS banner adapter of the Notifier port (D-22). It runs `osascript` once per delivery with a FIXED AppleScript
// and passes the body and the title as arguments after `--`, so message text is data and is never interpolated into the script
// (T-03-29). The call is bounded by a timeout and starts no detached child.
import { execFile } from 'node:child_process';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { CapabilityDescriptor } from '../../ports/capability.ts';
import type { Notifier, NotifierMessage } from '../../ports/notifier.ts';

export const DEFAULT_OSASCRIPT_TIMEOUT_MS = 10_000;

// The three -e lines never change; `--` ends osascript's own option parsing, so the body and the title that follow are positional
// arguments of the script's `run argv` handler whatever characters they hold.
export function osascriptArgs(message: NotifierMessage): string[] {
  return ['-e', 'on run argv', '-e', 'display notification (item 1 of argv) with title (item 2 of argv)', '-e', 'end run', '--', message.body, message.title];
}

export interface LocalNotifierOptions {
  osascriptPath: string;
  timeoutMs?: number;
}

export class LocalNotifier implements Notifier {
  readonly descriptor: CapabilityDescriptor;
  readonly #path: string;
  readonly #timeoutMs: number;

  constructor(options: LocalNotifierOptions) {
    this.#path = options.osascriptPath;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_OSASCRIPT_TIMEOUT_MS;
    this.descriptor = {
      port: 'notifier',
      adapter: 'local-osascript',
      version: '1.0.0',
      capabilities: { banner: true, push: false },
      attributes: { destination: 'local' },
      offline: true,
    };
  }

  // The error codes are the first token of the `unavailable` cause: osascript-missing (no such file), osascript-timeout (killed after
  // the timeout) and osascript-failed (any other failure, a non-zero exit included).
  deliver(message: NotifierMessage): Promise<Result<void>> {
    return new Promise((resolve) => {
      execFile(this.#path, osascriptArgs(message), { timeout: this.#timeoutMs, killSignal: 'SIGKILL', windowsHide: true }, (error) => {
        if (error === null) {
          resolve(ok(undefined));
          return;
        }
        const failure = error as NodeJS.ErrnoException & { killed?: boolean };
        if (failure.code === 'ENOENT') resolve(err({ kind: 'unavailable', cause: 'osascript-missing' }));
        else if (failure.killed === true) resolve(err({ kind: 'unavailable', cause: 'osascript-timeout' }));
        else resolve(err({ kind: 'unavailable', cause: 'osascript-failed' }));
      });
    });
  }
}
