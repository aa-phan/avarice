// CmdProvider: resolves `cmd:<helper name>` by running an owner-approved helper (SEC-2, ADR-009, T-04-38). The helper must be listed in the
// profile's `credentials.helpers` (name to absolute path); it is run through the sandboxed CommandExecutor by argv alone (the helper path
// is the whole argument list), with the network denied, an environment of PATH and HOME only, no inherited variable, and a 5 s timeout.
// Its stdout, trimmed, is the credential. Its stderr is dropped here, never read, logged or put in an error. The redactor is seeded
// before the handle is built.
import { err } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { CapabilityDescriptor } from '../../ports/capability.ts';
import { TRUNCATION_MARKER } from '../../ports/command-executor.ts';
import type { CommandExecutor } from '../../ports/command-executor.ts';
import type { CredentialProvider, ResolveContext, SecretHandle } from '../../ports/credential-provider.ts';
import { sealValue, seedOnResolved } from './handle.ts';
import type { OnResolved } from './handle.ts';

// The only variables a helper is given (the scrub list).
export const HELPER_ENV_NAMES: readonly string[] = ['PATH', 'HOME'];
export const HELPER_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
export const HELPER_TIMEOUT_MS = 5_000;
// A credential is a token or a password; a helper that prints more than this is not printing one.
const HELPER_OUTPUT_LIMIT_BYTES = 16 * 1024;
const FALLBACK_INVOCATION = 'credential-helper';

export interface CmdProviderOptions {
  executor: CommandExecutor;
  // The approved helpers of the profile: name to absolute path (`credentials.helpers`).
  helpers: Readonly<Record<string, string>>;
  // The working directory of a helper: an existing absolute directory, for example the profile's work root.
  cwd: string;
  // The HOME a helper sees; defaults to the working directory so that nothing of this process's environment leaks.
  home?: string;
  // Replaces the 5 s timeout. Only tests set it.
  timeoutMs?: number;
  onResolved?: OnResolved;
}

export class CmdProvider implements CredentialProvider {
  readonly #executor: CommandExecutor;
  readonly #helpers: Readonly<Record<string, string>>;
  readonly #cwd: string;
  readonly #home: string;
  readonly #timeoutMs: number;
  readonly #onResolved: OnResolved;

  constructor(options: CmdProviderOptions) {
    this.#executor = options.executor;
    this.#helpers = options.helpers;
    this.#cwd = options.cwd;
    this.#home = options.home ?? options.cwd;
    this.#timeoutMs = options.timeoutMs ?? HELPER_TIMEOUT_MS;
    this.#onResolved = options.onResolved ?? seedOnResolved;
  }

  get descriptor(): CapabilityDescriptor {
    return { port: 'credential', adapter: 'cmd', version: '1', capabilities: { delegated: false }, offline: true, attributes: { helpers: String(Object.keys(this.#helpers).length) } };
  }

  async resolve(name: string, _purpose: string, ctx?: ResolveContext): Promise<Result<SecretHandle>> {
    if (!Object.hasOwn(this.#helpers, name)) return err({ kind: 'denied', rule: 'credential-helper-not-listed', enforcer: 'avarice' });
    const helper = this.#helpers[name] as string;
    const ran = await this.#executor.run({
      argv: [helper],
      cwd: this.#cwd,
      env: { PATH: HELPER_PATH, HOME: this.#home },
      timeoutMs: this.#timeoutMs,
      outputLimitBytes: HELPER_OUTPUT_LIMIT_BYTES,
      invocationId: ctx?.invocationId ?? FALLBACK_INVOCATION,
      writePaths: [],
      denyReadPaths: [],
    });
    if (!ran.ok) return err({ kind: 'unavailable', cause: ran.error.kind === 'unavailable' ? ran.error.cause : 'the helper could not be run' });
    const result = ran.value;
    // The helper's stderr is never read.
    if (result.status === 'timed_out') return err({ kind: 'timeout', afterMs: this.#timeoutMs, sideEffect: 'unknown' });
    if (result.status === 'cancelled') return err({ kind: 'cancelled', sideEffect: 'unknown' });
    if (result.status !== 'passed' || result.exitCode !== 0) {
      return err({ kind: 'unavailable', cause: `the helper did not succeed (${result.status === 'failed' && result.exitCode !== null ? `exit ${result.exitCode}` : result.status})` });
    }
    // `truncated` is set when either stream was cut, so a helper that only fills stderr would look oversized. A stream that hit the limit ends with
    // the marker, so the size of the credential is judged from stdout's own ending, and stderr stays unread.
    if (result.stdout.endsWith(TRUNCATION_MARKER)) return err({ kind: 'invalid', field: 'value', reason: `the helper printed more than ${HELPER_OUTPUT_LIMIT_BYTES} bytes` });
    return sealValue(result.stdout.trim(), this.#onResolved);
  }
}
