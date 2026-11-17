// The credential broker's application service (SEC-2, S-48, ADR-009). A reference is resolved at the moment of use from an approved
// provider; every attempt, whatever its outcome, appends one `credential.resolve` event that holds the reference, the stated purpose, the
// calling module, the profile, the outcome and the duration, and never the value, its length or a digest of it. The run and invocation
// IDs ride on the event's own columns. The provider seeds the process redactor before it returns the handle, so everything written after
// a resolution is redacted (SEC-3).
import { parseCredentialRef, printable } from '../domain/credential-ref.ts';
import type { ProviderName } from '../domain/credential-ref.ts';
import { err } from '../domain/result.ts';
import type { PortError, Result } from '../domain/result.ts';
import type { CredentialProvider, SecretHandle } from '../ports/credential-provider.ts';
import type { Ledger } from '../ports/ledger.ts';
import type { Clock } from './deps.ts';

export const CREDENTIAL_RESOLVE_EVENT = 'credential.resolve';

export type CredentialOutcome = 'resolved' | 'unavailable' | 'denied' | 'invalid';

// What the broker needs: the ledger for the event, the clock for its time and duration, the profile it records, and the providers the
// profile may use (composition builds only those).
export interface CredentialDeps {
  ledger: Ledger;
  clock: Clock;
  profile: { profile: string };
  providers: Partial<Record<ProviderName, CredentialProvider>>;
}

export interface CredentialContext {
  // The calling module, for the audit.
  module: string;
  runId?: string;
  invocationId?: string;
}

const MAX_SHOWN_FIELD = 160;

function outcomeOf(error: PortError): CredentialOutcome {
  if (error.kind === 'denied') return 'denied';
  if (error.kind === 'invalid') return 'invalid';
  return 'unavailable';
}

export async function resolveCredential(deps: CredentialDeps, ref: string, purpose: string, ctx: CredentialContext): Promise<Result<SecretHandle>> {
  const started = deps.clock.nowMs();
  const result = await attempt(deps, ref, purpose, ctx);
  const finished = deps.clock.nowMs();
  const outcome: CredentialOutcome = result.ok ? 'resolved' : outcomeOf(result.error);
  const recorded = deps.ledger.appendEvent({
    type: CREDENTIAL_RESOLVE_EVENT,
    level: result.ok ? 'info' : 'warn',
    ...(ctx.runId !== undefined ? { runId: ctx.runId } : {}),
    ...(ctx.invocationId !== undefined ? { invocationId: ctx.invocationId } : {}),
    data: {
      reference: printable(String(ref), MAX_SHOWN_FIELD),
      purpose: printable(String(purpose), MAX_SHOWN_FIELD),
      module: printable(String(ctx.module), MAX_SHOWN_FIELD),
      profile: deps.profile.profile,
      outcome,
      durationMs: Math.max(0, finished - started),
    },
    nowMs: finished,
  });
  // An attempt that cannot be audited does not hand out a value (S-48).
  if (!recorded.ok) return err({ kind: 'internal', cause: 'the credential.resolve event could not be recorded; the credential was not handed out' });
  return result;
}

async function attempt(deps: CredentialDeps, ref: string, purpose: string, ctx: CredentialContext): Promise<Result<SecretHandle>> {
  const parsed = parseCredentialRef(ref);
  if (!parsed.ok) return parsed;
  const provider = deps.providers[parsed.value.provider];
  if (provider === undefined) return err({ kind: 'unavailable', cause: `no ${parsed.value.provider} credential provider is configured` });
  try {
    return await provider.resolve(parsed.value.name, purpose, ctx.invocationId !== undefined ? { invocationId: ctx.invocationId } : {});
  } catch {
    // A provider never throws across the port; if one does, its message is not trusted to be free of the value.
    return err({ kind: 'internal', cause: 'the credential provider failed' });
  }
}
