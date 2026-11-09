// LocalNotifier: the macOS banner adapter of the Notifier port (D-22). RED stub: the behavior arrives in the GREEN commit.
import { err } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { CapabilityDescriptor } from '../../ports/capability.ts';
import type { Notifier, NotifierMessage } from '../../ports/notifier.ts';

export const DEFAULT_OSASCRIPT_TIMEOUT_MS = 10_000;

export function osascriptArgs(_message: NotifierMessage): string[] {
  return [];
}

export interface LocalNotifierOptions {
  osascriptPath: string;
  timeoutMs?: number;
}

export class LocalNotifier implements Notifier {
  readonly descriptor: CapabilityDescriptor = { port: 'notifier', adapter: 'local-osascript', version: '1.0.0', capabilities: {}, offline: true };

  constructor(_options: LocalNotifierOptions) {}

  deliver(_message: NotifierMessage): Promise<Result<void>> {
    return Promise.resolve(err({ kind: 'internal', cause: 'not implemented' }));
  }
}
