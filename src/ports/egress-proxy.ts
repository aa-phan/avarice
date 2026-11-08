// EgressProxy port (D-11). A supervisor step that needs the network (the dependency install, ONB-10's network detection) never
// gets the network itself: the sandbox allows one loopback port (CommandSpec.allowLoopbackPorts) and the proxy listening
// there admits only an exact `host:port` allowlist. The proxy lives for one step; it is never given to an agent invocation.
import type { Result } from '../domain/result.ts';

// One connection attempt as the proxy saw it: the target host and port, never a path or a header. `host` is `invalid` and
// `port` is 0 when the request named no usable target.
export interface EgressAttempt {
  host: string;
  port: number;
  allowed: boolean;
  atMs: number;
}

export interface EgressProxyHandle {
  // The loopback port the proxy listens on (127.0.0.1 only).
  port: number;
  // Every attempt so far, in order.
  attempts(): EgressAttempt[];
  // Stops the listener and destroys open tunnels. Idempotent.
  close(): Promise<void>;
}

export interface EgressProxy {
  // `allow` holds exact `host:port` values (host compared lower-case); an entry that is not host:port is `invalid`.
  start(input: { allow: readonly string[]; onAttempt?: (attempt: EgressAttempt) => void }): Promise<Result<EgressProxyHandle>>;
}
