// Allowlisting CONNECT proxy (D-11, T-02-15, T-02-117, T-02-118). Seatbelt cannot filter by host name (`host must be * or localhost`), so a
// sandboxed supervisor step is given one loopback port and this proxy listens there. It accepts CONNECT only to an exact
// `host:port` in its allowlist (host compared lower-case), answers 403 to any other target, 400 to a malformed target and
// 405 to anything that is not CONNECT, and reports every attempt to its observer: host and port, never a path or header.
// For an allowlisted name the proxy resolves the host itself, refuses the tunnel (403) when any resolved address is not public
// (loopback, private, shared, link-local, multicast, reserved) and dials the vetted address, never the name, so a second
// resolution cannot rebind it (R-WR-02). Node built-ins only (NFR-1); the listener binds 127.0.0.1 on an ephemeral port and
// lives until close().
import { lookup } from 'node:dns/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import { connect, isIP, isIPv4, isIPv6 } from 'node:net';
import type { Socket } from 'node:net';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { EgressAttempt, EgressProxy, EgressProxyHandle } from '../../ports/egress-proxy.ts';

// host:port with a plain DNS name or IPv4 literal host and a decimal port.
const TARGET = /^([a-z0-9][a-z0-9.-]*):(\d{1,5})$/i;

function parseTarget(text: string): { host: string; port: number } | undefined {
  const m = TARGET.exec(text);
  if (m === null) return undefined;
  const port = Number(m[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  return { host: (m[1] as string).toLowerCase(), port };
}

// The target of a non-CONNECT request, for the attempt record only: the absolute-form URL's host and port, else the Host header.
function plainTarget(req: IncomingMessage): { host: string; port: number } {
  try {
    const url = new URL(req.url ?? '');
    if (url.hostname.length > 0) return { host: url.hostname.toLowerCase(), port: url.port.length > 0 ? Number(url.port) : url.protocol === 'https:' ? 443 : 80 };
  } catch {
    // not an absolute URL: fall through to the Host header
  }
  const hostHeader = typeof req.headers.host === 'string' ? req.headers.host : '';
  const withPort = parseTarget(hostHeader);
  if (withPort !== undefined) return withPort;
  const bare = /^([a-z0-9][a-z0-9.-]*)$/i.exec(hostHeader);
  return bare === null ? { host: 'invalid', port: 0 } : { host: (bare[1] as string).toLowerCase(), port: 80 };
}

function refuse(socket: Socket, status: string): void {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

// Resolves an allowed host to the one address the tunnel is opened to. `invalid` means the host is refused (an address that is not
// public); any other error means the lookup failed.
export type ResolveHost = (host: string) => Promise<Result<string>>;

function ipv4Octets(text: string): number[] | undefined {
  return isIPv4(text) ? text.split('.').map(Number) : undefined;
}

// Eight 16-bit groups of an IPv6 address; an embedded IPv4 tail counts as its last two groups.
function ipv6Groups(text: string): number[] | undefined {
  if (!isIPv6(text)) return undefined;
  let body = text.includes('%') ? text.slice(0, text.indexOf('%')) : text;
  const lastColon = body.lastIndexOf(':');
  const tail = body.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = ipv4Octets(tail);
    if (v4 === undefined) return undefined;
    body = `${body.slice(0, lastColon + 1)}${(((v4[0] as number) << 8) | (v4[1] as number)).toString(16)}:${(((v4[2] as number) << 8) | (v4[3] as number)).toString(16)}`;
  }
  const halves = body.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] === '' ? [] : (halves[0] as string).split(':');
  const rest = halves.length === 2 && halves[1] !== '' ? (halves[1] as string).split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return undefined;
  const groups = [...head, ...new Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest].map((g) => Number.parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : undefined;
}

function publicIPv4([a, b, c]: number[]): boolean {
  if (a === undefined || b === undefined || c === undefined) return false;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false; // this network, private, loopback, multicast and reserved
  if (a === 100 && b >= 64 && b <= 127) return false; // shared address space (CGNAT)
  if (a === 169 && b === 254) return false; // link-local, the cloud metadata address included
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && ((b === 0 && c === 0) || b === 168)) return false;
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  return true;
}

// True only for a public unicast address. A string that is not an IP address is not public; an IPv4-mapped IPv6 address and an
// address under the NAT64 prefix 64:ff9b::/96 are judged by the IPv4 address they carry.
export function isPublicAddress(ip: string): boolean {
  const v4 = ipv4Octets(ip);
  if (v4 !== undefined) return publicIPv4(v4);
  const g = ipv6Groups(ip);
  if (g === undefined) return false;
  const embedded = [(g[6] as number) >> 8, (g[6] as number) & 0xff, (g[7] as number) >> 8, (g[7] as number) & 0xff];
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return publicIPv4(embedded);
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return publicIPv4(embedded);
  if (g.slice(0, 6).every((x) => x === 0)) return false; // unspecified, loopback and the deprecated IPv4-compatible form
  const first = g[0] as number;
  if ((first & 0xfe00) === 0xfc00) return false; // unique local
  if ((first & 0xffc0) === 0xfe80) return false; // link-local
  if ((first & 0xff00) === 0xff00) return false; // multicast
  return true;
}

// The production resolver: an IP literal is its own address, a name is looked up and every address it has must be public.
async function resolvePublicAddress(host: string): Promise<Result<string>> {
  const refuse = (reason: string): Result<string> => err({ kind: 'invalid', field: 'host', reason });
  if (isIP(host) !== 0) return isPublicAddress(host) ? ok(host) : refuse(`${host} is not a public address`);
  let found: Array<{ address: string }>;
  try {
    found = await lookup(host, { all: true, verbatim: true });
  } catch (e) {
    return err({ kind: 'unavailable', cause: `${host} did not resolve: ${(e as NodeJS.ErrnoException).code ?? 'error'}` });
  }
  const first = found[0];
  if (first === undefined) return refuse(`${host} has no address`);
  const nonPublic = found.find((a) => !isPublicAddress(a.address));
  return nonPublic === undefined ? ok(first.address) : refuse(`${host} resolves to ${nonPublic.address}, which is not a public address`);
}

// `resolve` is test-only: it replaces resolution and the address check so a test can dial a loopback server. Production composition
// never passes it (the egress port's input has no such option and the footprint test pins every call site).
export async function startAllowlistProxy(input: { allow: readonly string[]; onAttempt?: (attempt: EgressAttempt) => void; resolve?: ResolveHost }): Promise<Result<EgressProxyHandle>> {
  const resolveHost: ResolveHost = input.resolve ?? resolvePublicAddress;
  const allowed = new Set<string>();
  for (const entry of input.allow) {
    const target = typeof entry === 'string' ? parseTarget(entry) : undefined;
    if (target === undefined) return err({ kind: 'invalid', field: 'allow', reason: `${JSON.stringify(entry)} is not an exact host:port` });
    allowed.add(`${target.host}:${target.port}`);
  }

  const attempts: EgressAttempt[] = [];
  const sockets = new Set<Socket>();
  const record = (host: string, port: number, isAllowed: boolean): void => {
    const attempt: EgressAttempt = { host, port, allowed: isAllowed, atMs: Date.now() };
    attempts.push(attempt);
    try {
      input.onAttempt?.({ ...attempt });
    } catch {
      // an observer failure never changes what the proxy admits
    }
  };
  const track = (socket: Socket): void => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.once('close', () => sockets.delete(socket));
  };

  const server: Server = createServer((req, res) => {
    const target = plainTarget(req);
    record(target.host, target.port, false);
    res.writeHead(405, { Allow: 'CONNECT', Connection: 'close', 'Content-Length': '0' });
    res.end();
  });
  server.on('connection', track);
  server.on('clientError', (error: NodeJS.ErrnoException, socket) => {
    // A request line the parser rejects (for example a target with a space): refused and reported as invalid.
    if (error.code !== 'ECONNRESET') record('invalid', 0, false);
    refuse(socket as Socket, '400 Bad Request');
  });
  server.on('connect', (req: IncomingMessage, client: Socket, head: Buffer) => {
    const target = parseTarget(req.url ?? '');
    if (target === undefined) {
      record('invalid', 0, false);
      refuse(client, '400 Bad Request');
      return;
    }
    const permitted = allowed.has(`${target.host}:${target.port}`);
    if (!permitted) {
      record(target.host, target.port, false);
      refuse(client, '403 Forbidden');
      return;
    }
    void admit(target, client, head);
  });

  // An allowlisted target: resolve the name, refuse a host the resolver refuses (403), fail a lookup that failed (502), else
  // connect to the vetted address.
  async function admit(target: { host: string; port: number }, client: Socket, head: Buffer): Promise<void> {
    let resolved: Result<string>;
    try {
      resolved = await resolveHost(target.host);
    } catch (e) {
      resolved = err({ kind: 'unavailable', cause: e instanceof Error ? e.message : 'the resolver failed' });
    }
    if (!resolved.ok) {
      const refusedHost = resolved.error.kind === 'invalid';
      record(target.host, target.port, !refusedHost);
      refuse(client, refusedHost ? '403 Forbidden' : '502 Bad Gateway');
      return;
    }
    record(target.host, target.port, true);
    if (client.destroyed) return;
    const upstream = connect(target.port, resolved.value);
    track(upstream);
    let established = false;
    upstream.once('connect', () => {
      established = true;
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.once('error', () => {
      if (!established) refuse(client, '502 Bad Gateway');
      else client.destroy();
    });
    upstream.once('close', () => client.destroy());
    client.once('close', () => upstream.destroy());
  }

  const listening = await new Promise<Result<number>>((resolve) => {
    server.once('error', (e: NodeJS.ErrnoException) => resolve(err({ kind: 'unavailable', cause: `the allowlist proxy could not listen: ${e.code ?? e.message}` })));
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(address !== null && typeof address === 'object' ? ok(address.port) : err({ kind: 'internal', cause: 'the allowlist proxy has no address' }));
    });
  });
  if (!listening.ok) return listening;

  let closing: Promise<void> | undefined;
  return ok({
    port: listening.value,
    attempts: () => attempts.map((a) => ({ ...a })),
    close: () => {
      closing ??= new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
        server.closeAllConnections();
      });
      return closing;
    },
  });
}

export class AllowlistEgressProxy implements EgressProxy {
  start({ allow, onAttempt }: { allow: readonly string[]; onAttempt?: (attempt: EgressAttempt) => void }): Promise<Result<EgressProxyHandle>> {
    return startAllowlistProxy({ allow, onAttempt });
  }
}
