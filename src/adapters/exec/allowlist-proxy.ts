// Allowlisting CONNECT proxy (D-11, T-02-15). Seatbelt cannot filter by host name (`host must be * or localhost`), so a
// sandboxed supervisor step is given one loopback port and this proxy listens there. It accepts CONNECT only to an exact
// `host:port` in its allowlist (host compared lower-case), answers 403 to any other target, 400 to a malformed target and
// 405 to anything that is not CONNECT, and reports every attempt to its observer: host and port, never a path or header.
// Node built-ins only (NFR-1); the listener binds 127.0.0.1 on an ephemeral port and lives until close().
import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import { connect } from 'node:net';
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

export async function startAllowlistProxy(input: { allow: readonly string[]; onAttempt?: (attempt: EgressAttempt) => void }): Promise<Result<EgressProxyHandle>> {
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
    record(target.host, target.port, permitted);
    if (!permitted) {
      refuse(client, '403 Forbidden');
      return;
    }
    const upstream = connect(target.port, target.host);
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
  });

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
  start(input: { allow: readonly string[]; onAttempt?: (attempt: EgressAttempt) => void }): Promise<Result<EgressProxyHandle>> {
    return startAllowlistProxy(input);
  }
}
