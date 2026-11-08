// Plan 02-06 Task 2: the allowlisting CONNECT proxy (D-11). Seatbelt cannot filter by host name, so a supervisor step gets
// one loopback port and this proxy admits only the exact host:port values it was started with. Every test uses loopback
// servers only; nothing here reaches beyond 127.0.0.1.
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { connect, createServer } from 'node:net';
import type { AddressInfo, Server, Socket } from 'node:net';
import { AllowlistEgressProxy, isPublicAddress, startAllowlistProxy } from '../../src/adapters/exec/allowlist-proxy.ts';
import type { ResolveHost } from '../../src/adapters/exec/allowlist-proxy.ts';
import { err, ok } from '../../src/domain/result.ts';
import type { EgressAttempt } from '../../src/ports/egress-proxy.ts';

const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (closers.length > 0) await (closers.pop() as () => Promise<void> | void)();
});

// A TCP echo server on 127.0.0.1; reports how many connections it accepted.
async function echoServer(): Promise<{ port: number; accepted: () => number; sockets: Set<Socket> }> {
  let accepted = 0;
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    accepted += 1;
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
    socket.pipe(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(() => {
    for (const s of sockets) s.destroy();
    server.close();
  });
  return { port: (server.address() as AddressInfo).port, accepted: () => accepted, sockets };
}

// A port nothing listens on: bind, read the number, close.
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

// The test resolver (R-WR-02): every allowed name dials the loopback echo servers. The production proxy vets the address; tests that
// need a loopback server replace that through this seam, and the cases further down start the proxy without it.
const LOOPBACK: ResolveHost = () => Promise.resolve(ok('127.0.0.1'));

async function startProxy(allow: string[], onAttempt?: (a: EgressAttempt) => void, resolve: ResolveHost = LOOPBACK) {
  const started = await startAllowlistProxy({ allow, resolve, ...(onAttempt === undefined ? {} : { onAttempt }) });
  assert.ok(started.ok, JSON.stringify(started));
  closers.push(() => started.value.close());
  return started.value;
}

// Sends a raw request to the proxy and returns the status line and the open socket (positioned after the header).
function rawRequest(proxyPort: number, request: string): Promise<{ statusLine: string; rest: Buffer; socket: Socket }> {
  return new Promise((resolve, reject) => {
    const socket = connect(proxyPort, '127.0.0.1');
    let buf = Buffer.alloc(0);
    socket.on('error', reject);
    const onData = (chunk: Buffer): void => {
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf('\r\n\r\n');
      if (end === -1) return;
      socket.off('data', onData);
      socket.pause();
      resolve({ statusLine: buf.subarray(0, buf.indexOf('\r\n')).toString('latin1'), rest: buf.subarray(end + 4), socket });
    };
    socket.on('data', onData);
    socket.on('connect', () => socket.write(request));
    closers.push(() => {
      socket.destroy();
    });
  });
}

const connectRequest = (target: string): string => `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`;

function readSome(socket: Socket, bytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let got = '';
    const onData = (chunk: Buffer): void => {
      got += chunk.toString('utf8');
      if (got.length >= bytes) {
        socket.off('data', onData);
        socket.pause();
        resolve(got);
      }
    };
    socket.on('error', reject);
    socket.on('data', onData);
    socket.resume();
  });
}

describe('startAllowlistProxy', () => {
  it('tunnels bytes both ways to an allowed target', async () => {
    const echo = await echoServer();
    const proxy = await startProxy([`127.0.0.1:${echo.port}`]);
    const { statusLine, socket } = await rawRequest(proxy.port, connectRequest(`127.0.0.1:${echo.port}`));
    assert.match(statusLine, /^HTTP\/1\.1 200 /);
    socket.write('hello through the tunnel');
    assert.equal(await readSome(socket, 'hello through the tunnel'.length), 'hello through the tunnel');
    assert.equal(echo.accepted(), 1);
    assert.deepEqual(proxy.attempts().map((a) => ({ host: a.host, port: a.port, allowed: a.allowed })), [{ host: '127.0.0.1', port: echo.port, allowed: true }]);
  });

  it('answers 403 to a CONNECT outside the allowlist and never opens the upstream connection', async () => {
    const allowed = await echoServer();
    const other = await echoServer();
    const proxy = await startProxy([`127.0.0.1:${allowed.port}`]);
    const { statusLine } = await rawRequest(proxy.port, connectRequest(`127.0.0.1:${other.port}`));
    assert.match(statusLine, /^HTTP\/1\.1 403 /);
    assert.equal(other.accepted(), 0, 'the other server saw no connection');
    assert.deepEqual(proxy.attempts().map((a) => ({ host: a.host, port: a.port, allowed: a.allowed })), [{ host: '127.0.0.1', port: other.port, allowed: false }]);
  });

  it('matches the exact host and port: the allowed host on another port is refused', async () => {
    const echo = await echoServer();
    const proxy = await startProxy([`127.0.0.1:${echo.port}`]);
    const { statusLine } = await rawRequest(proxy.port, connectRequest(`127.0.0.1:${echo.port + 1}`));
    assert.match(statusLine, /^HTTP\/1\.1 403 /);
    const sub = await rawRequest(proxy.port, connectRequest(`evil.127.0.0.1:${echo.port}`));
    assert.match(sub.statusLine, /^HTTP\/1\.1 403 /);
  });

  it('lower-cases the host on both sides of the comparison', async () => {
    const echo = await echoServer();
    const proxy = await startProxy([`LocalHost:${echo.port}`]);
    const { statusLine } = await rawRequest(proxy.port, connectRequest(`LOCALHOST:${echo.port}`));
    assert.match(statusLine, /^HTTP\/1\.1 200 /);
    assert.equal(proxy.attempts()[0]?.host, 'localhost');
  });

  it('answers 405 to a non-CONNECT request and reports the target without its path', async () => {
    const seen: EgressAttempt[] = [];
    const proxy = await startProxy([], (a) => seen.push(a));
    const { statusLine } = await rawRequest(proxy.port, 'GET http://example.invalid/secret/path?token=abc HTTP/1.1\r\nHost: example.invalid\r\n\r\n');
    assert.match(statusLine, /^HTTP\/1\.1 405 /);
    assert.equal(seen.length, 1);
    assert.deepEqual({ host: seen[0]?.host, port: seen[0]?.port, allowed: seen[0]?.allowed }, { host: 'example.invalid', port: 80, allowed: false });
    assert.ok(!JSON.stringify(proxy.attempts()).includes('secret'), 'no path or query is kept');
  });

  it('refuses a malformed CONNECT target with 400 and reports it as host "invalid"', async () => {
    const proxy = await startProxy(['127.0.0.1:9']);
    for (const target of ['127.0.0.1:9/path', 'user:pw@127.0.0.1:9', '127.0.0.1:0', '127.0.0.1:70000', '127.0.0.1:abc', '127.0.0.1', 'a b:80']) {
      const { statusLine } = await rawRequest(proxy.port, connectRequest(target));
      assert.match(statusLine, /^HTTP\/1\.1 400 /, target);
    }
    const attempts = proxy.attempts();
    assert.equal(attempts.length, 7);
    for (const a of attempts) assert.deepEqual({ host: a.host, allowed: a.allowed }, { host: 'invalid', allowed: false });
  });

  it('answers 502 when an allowed target cannot be reached', async () => {
    const port = await closedPort();
    const proxy = await startProxy([`127.0.0.1:${port}`]);
    const { statusLine } = await rawRequest(proxy.port, connectRequest(`127.0.0.1:${port}`));
    assert.match(statusLine, /^HTTP\/1\.1 502 /);
    assert.equal(proxy.attempts()[0]?.allowed, true, 'the attempt was admitted; the upstream was down');
  });

  it('records every attempt with a clock reading and calls the observer once per attempt', async () => {
    const echo = await echoServer();
    const seen: EgressAttempt[] = [];
    const before = Date.now();
    const proxy = await startProxy([`127.0.0.1:${echo.port}`], (a) => seen.push(a));
    await rawRequest(proxy.port, connectRequest(`127.0.0.1:${echo.port}`));
    await rawRequest(proxy.port, connectRequest('127.0.0.1:1'));
    assert.equal(seen.length, 2);
    assert.deepEqual(seen, proxy.attempts());
    for (const a of seen) assert.ok(a.atMs >= before && a.atMs <= Date.now());
  });

  it('survives an observer that throws', async () => {
    const proxy = await startProxy([], () => {
      throw new Error('observer failed');
    });
    const { statusLine } = await rawRequest(proxy.port, connectRequest('127.0.0.1:1'));
    assert.match(statusLine, /^HTTP\/1\.1 403 /);
  });

  it('binds 127.0.0.1 only', async () => {
    const proxy = await startProxy([]);
    // The adapter exposes the port only; prove the bind by connecting on loopback and by a non-loopback refusal.
    const socket = connect(proxy.port, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    socket.destroy();
    const { networkInterfaces } = await import('node:os');
    const external = Object.values(networkInterfaces()).flat().find((i) => i !== undefined && !i.internal && i.family === 'IPv4');
    if (external !== undefined) {
      const refused = await new Promise<string>((resolve) => {
        const s = connect(proxy.port, external.address);
        s.once('connect', () => {
          s.destroy();
          resolve('connected');
        });
        s.once('error', (e) => resolve((e as NodeJS.ErrnoException).code ?? 'error'));
      });
      assert.equal(refused, 'ECONNREFUSED', 'not reachable on a non-loopback address');
    }
  });

  it('refuses an allow entry that is not host:port', async () => {
    for (const bad of ['registry.npmjs.org', 'registry.npmjs.org:0', 'registry.npmjs.org:70000', '*:443', 'a/b:443', '']) {
      const started = await startAllowlistProxy({ allow: [bad] });
      assert.ok(!started.ok, JSON.stringify(bad));
      assert.equal(started.error.kind, 'invalid');
      assert.equal((started.error as { field?: string }).field, 'allow');
    }
  });

  it('close() stops the listener, destroys open tunnels and a second close() is a no-op', async () => {
    const echo = await echoServer();
    const proxy = await startAllowlistProxy({ allow: [`127.0.0.1:${echo.port}`], resolve: LOOPBACK });
    assert.ok(proxy.ok);
    const { statusLine, socket } = await rawRequest(proxy.value.port, connectRequest(`127.0.0.1:${echo.port}`));
    assert.match(statusLine, /^HTTP\/1\.1 200 /);
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    await proxy.value.close();
    await closed;
    assert.equal(socket.destroyed, true, 'the open tunnel was destroyed');
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    assert.equal(echo.sockets.size, 0, 'the upstream side of the tunnel was destroyed too');
    const refused = await new Promise<string>((resolve) => {
      const s = connect(proxy.value.port, '127.0.0.1');
      s.once('connect', () => {
        s.destroy();
        resolve('connected');
      });
      s.once('error', (e) => resolve((e as NodeJS.ErrnoException).code ?? 'error'));
    });
    assert.equal(refused, 'ECONNREFUSED');
    await assert.doesNotReject(proxy.value.close());
  });
});

describe('isPublicAddress (R-WR-02)', () => {
  it('refuses loopback, unspecified, private, shared, link-local, multicast and reserved addresses, IPv4 and IPv6, mapped forms included', () => {
    const refused = [
      '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.0.0.1', '192.168.1.1', '198.18.0.1', '224.0.0.1', '240.0.0.1', '255.255.255.255',
      '::', '::1', 'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::7f00:1',
    ];
    for (const ip of refused) assert.equal(isPublicAddress(ip), false, ip);
  });

  it('accepts a public address, a public mapped address and the edges of the private ranges', () => {
    for (const ip of ['8.8.8.8', '104.16.0.1', '172.32.0.1', '172.15.255.255', '100.63.255.255', '100.128.0.1', '2606:4700::1111', '::ffff:8.8.8.8', '64:ff9b::808:808']) assert.equal(isPublicAddress(ip), true, ip);
  });

  it('refuses a string that is not an IP address', () => {
    for (const text of ['', 'localhost', 'registry.npmjs.org', '8.8.8', '8.8.8.8.8', '2130706433', '0x7f.1', 'zz::1']) assert.equal(isPublicAddress(text), false, text);
  });
});

describe('the production proxy refuses an allowlisted host that is not public (R-WR-02, T-02-117)', () => {
  it('refuses localhost:<port> with 403, records the attempt as refused and the live server accepts no connection', async () => {
    const echo = await echoServer();
    const started = await startAllowlistProxy({ allow: [`localhost:${echo.port}`] });
    assert.ok(started.ok, JSON.stringify(started));
    closers.push(() => started.value.close());
    const { statusLine } = await rawRequest(started.value.port, connectRequest(`localhost:${echo.port}`));
    assert.match(statusLine, /^HTTP\/1\.1 403 /);
    assert.equal(echo.accepted(), 0, 'the loopback server saw no connection');
    assert.deepEqual(started.value.attempts().map((a) => ({ host: a.host, port: a.port, allowed: a.allowed })), [{ host: 'localhost', port: echo.port, allowed: false }]);
  });

  it('refuses the IP literal 127.0.0.1:<port> the same way', async () => {
    const echo = await echoServer();
    const started = await startAllowlistProxy({ allow: [`127.0.0.1:${echo.port}`] });
    assert.ok(started.ok, JSON.stringify(started));
    closers.push(() => started.value.close());
    const { statusLine } = await rawRequest(started.value.port, connectRequest(`127.0.0.1:${echo.port}`));
    assert.match(statusLine, /^HTTP\/1\.1 403 /);
    assert.equal(echo.accepted(), 0);
    assert.equal(started.value.attempts()[0]?.allowed, false);
  });

  it('refuses an allowlisted private and link-local literal without opening a connection', async () => {
    const started = await startAllowlistProxy({ allow: ['169.254.169.254:80', '10.0.0.5:443'] });
    assert.ok(started.ok, JSON.stringify(started));
    closers.push(() => started.value.close());
    for (const target of ['169.254.169.254:80', '10.0.0.5:443']) {
      const { statusLine } = await rawRequest(started.value.port, connectRequest(target));
      assert.match(statusLine, /^HTTP\/1\.1 403 /, target);
    }
    assert.deepEqual(started.value.attempts().map((a) => a.allowed), [false, false]);
  });

  it('AllowlistEgressProxy refuses 127.0.0.1:<port> even when its input carries a resolve property', async () => {
    const echo = await echoServer();
    const smuggled = { allow: [`127.0.0.1:${echo.port}`], resolve: LOOPBACK } as unknown as Parameters<AllowlistEgressProxy['start']>[0];
    const started = await new AllowlistEgressProxy().start(smuggled);
    assert.ok(started.ok, JSON.stringify(started));
    closers.push(() => started.value.close());
    const { statusLine } = await rawRequest(started.value.port, connectRequest(`127.0.0.1:${echo.port}`));
    assert.match(statusLine, /^HTTP\/1\.1 403 /);
    assert.equal(echo.accepted(), 0);
  });
});

describe('the proxy connects to the address its resolver vetted, never to the name (R-WR-02, T-02-118)', () => {
  it('opens the tunnel to the address resolve returned for an allowed name', async () => {
    const echo = await echoServer();
    const asked: string[] = [];
    const proxy = await startProxy([`registry.avarice.test:${echo.port}`], undefined, (host) => {
      asked.push(host);
      return Promise.resolve(ok('127.0.0.1'));
    });
    const { statusLine, socket } = await rawRequest(proxy.port, connectRequest(`registry.avarice.test:${echo.port}`));
    assert.match(statusLine, /^HTTP\/1\.1 200 /);
    socket.write('via the vetted address');
    assert.equal(await readSome(socket, 'via the vetted address'.length), 'via the vetted address');
    assert.deepEqual(asked, ['registry.avarice.test']);
    assert.deepEqual(proxy.attempts().map((a) => ({ host: a.host, allowed: a.allowed })), [{ host: 'registry.avarice.test', allowed: true }]);
  });

  it('answers 403 and records a refusal when the resolver refuses the host, with no connection made', async () => {
    const echo = await echoServer();
    const proxy = await startProxy([`registry.avarice.test:${echo.port}`], undefined, () => Promise.resolve(err({ kind: 'invalid', field: 'host', reason: 'resolves to a private address' })));
    const { statusLine } = await rawRequest(proxy.port, connectRequest(`registry.avarice.test:${echo.port}`));
    assert.match(statusLine, /^HTTP\/1\.1 403 /);
    assert.equal(echo.accepted(), 0);
    assert.equal(proxy.attempts()[0]?.allowed, false);
  });

  it('answers 502 and records the attempt as allowed when the resolver is unavailable (the target was allowlisted; the network failed)', async () => {
    const echo = await echoServer();
    const proxy = await startProxy([`registry.avarice.test:${echo.port}`], undefined, () => Promise.resolve(err({ kind: 'unavailable', cause: 'lookup failed' })));
    const { statusLine } = await rawRequest(proxy.port, connectRequest(`registry.avarice.test:${echo.port}`));
    assert.match(statusLine, /^HTTP\/1\.1 502 /);
    assert.equal(echo.accepted(), 0);
    assert.equal(proxy.attempts()[0]?.allowed, true);
  });

  it('does not resolve a target that is not on the allowlist', async () => {
    const asked: string[] = [];
    const proxy = await startProxy([], undefined, (host) => {
      asked.push(host);
      return Promise.resolve(ok('127.0.0.1'));
    });
    const { statusLine } = await rawRequest(proxy.port, connectRequest('registry.avarice.test:443'));
    assert.match(statusLine, /^HTTP\/1\.1 403 /);
    assert.deepEqual(asked, []);
  });
});

describe('AllowlistEgressProxy', () => {
  it('implements the EgressProxy port over startAllowlistProxy: a loopback port, 403 outside the allowlist, every attempt reported', async () => {
    const seen: EgressAttempt[] = [];
    const started = await new AllowlistEgressProxy().start({ allow: ['registry.npmjs.org:443'], onAttempt: (a) => seen.push(a) });
    assert.ok(started.ok, JSON.stringify(started));
    closers.push(() => started.value.close());
    const { statusLine } = await rawRequest(started.value.port, connectRequest('example.invalid:443'));
    assert.match(statusLine, /^HTTP\/1\.1 403 /);
    assert.deepEqual(seen.map((a) => ({ host: a.host, port: a.port, allowed: a.allowed })), [{ host: 'example.invalid', port: 443, allowed: false }]);
    assert.deepEqual(started.value.attempts(), seen);
  });

  it('refuses an allow entry that is not host:port', async () => {
    const started = await new AllowlistEgressProxy().start({ allow: ['registry.npmjs.org'] });
    assert.ok(!started.ok);
    assert.equal(started.error.kind, 'invalid');
  });
});
