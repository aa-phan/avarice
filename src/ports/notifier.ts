// The notifier port (D-22, AUT-6). A notifier raises one short message where the owner will see it. Today the only adapter posts a
// macOS banner through osascript; push adapters (ntfy, mail) can implement this same interface later without touching the app.
// The text is built by the app from AVARICE-owned words only (counts, IDs, the next command): an adapter treats it as data.
// A failed delivery is a Result error whose `cause` starts with a short code (`osascript-failed`), never a throw.
import type { Result } from '../domain/result.ts';
import type { CapabilityDescriptor } from './capability.ts';

export interface NotifierMessage {
  title: string;
  body: string;
}

export interface Notifier {
  readonly descriptor: CapabilityDescriptor;
  // Delivers the message once. Never retries and never waits for a person: the app owns the retry schedule.
  deliver(message: NotifierMessage): Promise<Result<void>>;
}
