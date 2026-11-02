// SEC-5 static scan: nothing under src/ may disable TLS verification, route through a proxy or add an
// alternate egress path. The scanner is a control, so it first proves it catches each construct.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '..', '..', 'src');

// Constructs that turn TLS verification off or redirect traffic. A bare mention counts: src/ has no reason to
// name any of them (the environment is an allowlist, so nothing needs to be listed for removal).
const FORBIDDEN: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: 'NODE_TLS_REJECT_UNAUTHORIZED', pattern: /NODE_TLS_REJECT_UNAUTHORIZED/ },
  { id: 'rejectUnauthorized false', pattern: /rejectUnauthorized\s*[:=]\s*(?:false|0|!1)/ },
  { id: 'strictSSL false', pattern: /strictSSL\s*[:=]\s*false/ },
  { id: 'checkServerIdentity override', pattern: /checkServerIdentity\s*[:=]/ },
  { id: 'ssl verify false', pattern: /ssl_?verify\s*[:=]\s*(?:false|0)/i },
  { id: 'GIT_SSL_NO_VERIFY', pattern: /GIT_SSL_NO_VERIFY|http\.sslVerify/ },
  { id: 'curl insecure', pattern: /--insecure|--no-check-certificate|--no-verify-ssl|--ignore-certificate-errors/ },
  { id: 'curl -k', pattern: /\bcurl\b[^\n]*\s-k\b/ },
  { id: 'trust-all agent', pattern: /new\s+https\.Agent\s*\(\s*\{[^}]*rejectUnauthorized/ },
  { id: 'proxy dispatcher', pattern: /\b(?:ProxyAgent|setGlobalDispatcher|HttpsProxyAgent|global-agent)\b/ },
  { id: 'proxy variable assignment', pattern: /\b(?:HTTPS?_PROXY|ALL_PROXY)\s*[:=]\s*['"`]/i },
];

function scan(text: string): string[] {
  return FORBIDDEN.filter((f) => f.pattern.test(text)).map((f) => f.id);
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) sourceFiles(full, out);
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('SEC-5 static scan', () => {
  it('the scanner catches every construct (positive controls)', () => {
    const samples: Record<string, string> = {
      NODE_TLS_REJECT_UNAUTHORIZED: "env.NODE_TLS_REJECT_UNAUTHORIZED = '0';",
      'rejectUnauthorized false': 'https.request({ rejectUnauthorized: false })',
      'strictSSL false': 'request({ strictSSL: false })',
      'checkServerIdentity override': 'tls.connect({ checkServerIdentity: () => undefined })',
      'ssl verify false': 'const opts = { sslVerify: false }',
      GIT_SSL_NO_VERIFY: "env['GIT_SSL_NO_VERIFY'] = '1'",
      'curl insecure': "run('curl --insecure https://x')",
      'curl -k': "run('curl -k https://x')",
      'trust-all agent': 'new https.Agent({ keepAlive: true, rejectUnauthorized: false })',
      'proxy dispatcher': 'setGlobalDispatcher(new ProxyAgent(url))',
      'proxy variable assignment': "env.HTTPS_PROXY = 'http://p'",
    };
    for (const f of FORBIDDEN) {
      const sample = samples[f.id];
      assert.ok(sample !== undefined, `no positive control for ${f.id}`);
      assert.ok(scan(sample).includes(f.id), `scanner missed ${f.id}`);
    }
    assert.deepEqual(scan("const safe = { rejectUnauthorized: true }; run('curl https://x')"), []);
  });

  it('scans the real source tree and finds a non-trivial number of files', () => {
    assert.ok(sourceFiles(SRC).length > 40);
  });

  it('finds no TLS-disabling or proxy construct in any .ts file under src/', () => {
    const hits: string[] = [];
    for (const file of sourceFiles(SRC)) {
      for (const id of scan(readFileSync(file, 'utf8'))) hits.push(`${file.slice(SRC.length + 1)}: ${id}`);
    }
    assert.deepEqual(hits, []);
  });
});
