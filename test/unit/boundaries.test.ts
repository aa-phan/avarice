import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// The lint is a control, so each rule is proven on a violation file generated at test time
// (no committed fixtures, so the repository itself stays clean under the lint).
const SCRIPT = resolve(import.meta.dirname, '../../scripts/check-boundaries.ts');
const REPO = resolve(import.meta.dirname, '../..');
const scratch = mkdtempSync(join(tmpdir(), 'avarice-boundaries-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

let counter = 0;

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

// Writes `files` (relative to a fresh root) and runs the lint on <root>/<layer> as `kind`.
function lint(kind: 'domain' | 'ports' | 'app', files: Record<string, string>, layer = kind): Run {
  const root = join(scratch, `case-${++counter}`);
  for (const [rel, text] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  mkdirSync(join(root, layer), { recursive: true });
  const r = spawnSync(process.execPath, [SCRIPT, '--root-as', kind, join(root, layer)], {
    encoding: 'utf8',
    cwd: root,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function assertViolation(run: Run, rule: string, specifier?: string): void {
  assert.equal(run.status, 1, `expected exit 1, got ${run.status}\n${run.stdout}${run.stderr}`);
  const hit = run.stdout.split('\n').find((l) => l.includes(` ${rule} `) || l.endsWith(` ${rule}`));
  assert.ok(hit, `no ${rule} line in:\n${run.stdout}`);
  if (specifier !== undefined) assert.ok(hit.includes(specifier), `${hit} lacks ${specifier}`);
}

function assertClean(run: Run): void {
  assert.equal(run.status, 0, `expected exit 0, got ${run.status}\n${run.stdout}${run.stderr}`);
}

describe('check-boundaries: domain rules', () => {
  it('fails a domain file importing node:fs', () => {
    assertViolation(lint('domain', { 'domain/a.ts': "import { readFileSync } from 'node:fs';\n" }), 'forbidden-import', 'node:fs');
  });

  it('fails a domain file importing bare fs', () => {
    assertViolation(lint('domain', { 'domain/a.ts': "import fs from 'fs';\n" }), 'forbidden-import', 'fs');
  });

  it('fails a domain file importing an adapter', () => {
    assertViolation(
      lint('domain', { 'domain/a.ts': "import { x } from '../adapters/x.ts';\n", 'adapters/x.ts': 'export const x = 1;\n' }),
      'layer-escape',
      '../adapters/x.ts',
    );
  });

  it('fails a domain file importing a bare package', () => {
    assertViolation(lint('domain', { 'domain/a.ts': "import leftPad from 'left-pad';\n" }), 'forbidden-import', 'left-pad');
  });

  it('fails a non-literal dynamic import()', () => {
    assertViolation(
      lint('domain', { 'domain/a.ts': "const m = 'node:fs';\nexport const load = () => import(m);\n" }),
      'dynamic-import',
    );
  });

  it('fails a template-literal dynamic import()', () => {
    assertViolation(lint('domain', { 'domain/a.ts': 'export const load = (n: string) => import(`./${n}.ts`);\n' }), 'dynamic-import');
  });

  it('fails a literal dynamic import() of a forbidden module', () => {
    assertViolation(
      lint('domain', { 'domain/a.ts': "export const load = () => import('node:fs');\n" }),
      'forbidden-import',
      'node:fs',
    );
  });

  it('fails require() of node:child_process and a non-literal require()', () => {
    assertViolation(
      lint('domain', { 'domain/a.ts': "const cp = require('node:child_process');\n" }),
      'forbidden-import',
      'node:child_process',
    );
    assertViolation(lint('domain', { 'domain/b.ts': 'const x = require(name);\n' }), 'dynamic-require');
  });

  it('fails createRequire', () => {
    assertViolation(
      lint('domain', { 'domain/a.ts': "import { createRequire } from 'node:module';\nconst r = createRequire(import.meta.url);\n" }),
      'create-require',
    );
  });

  it('fails re-exports and side-effect imports of forbidden modules, including multi-line forms', () => {
    assertViolation(lint('domain', { 'domain/a.ts': "export * from 'fs';\n" }), 'forbidden-import', 'fs');
    assertViolation(lint('domain', { 'domain/b.ts': "import 'node:os';\n" }), 'forbidden-import', 'node:os');
    assertViolation(
      lint('domain', { 'domain/c.ts': "import {\n  a,\n  b,\n} from\n  'node:path';\n" }),
      'forbidden-import',
      'node:path',
    );
    assertViolation(lint('domain', { 'domain/d.ts': "import type { T } from 'node:net';\n" }), 'forbidden-import', 'node:net');
  });

  it('fails use of process, with the line number of the use', () => {
    const run = lint('domain', { 'domain/a.ts': 'export const a = 1;\nexport const home = process.env.HOME;\n' });
    assertViolation(run, 'process-access');
    assert.match(run.stdout, /a\.ts:2 process-access/);
    assertViolation(lint('domain', { 'domain/b.ts': 'export const h = globalThis.process;\n' }), 'process-access');
  });

  it('passes node:crypto and relative imports inside the directory', () => {
    assertClean(
      lint('domain', {
        'domain/a.ts': "import { createHash } from 'node:crypto';\nimport { b } from './b.ts';\nimport { c } from './sub/c.ts';\nexport const a = [createHash, b, c];\n",
        'domain/b.ts': "import type { A } from './a.ts';\nexport const b: A | null = null;\n",
        'domain/sub/c.ts': "import { b } from '../b.ts';\nexport const c = b;\n",
      }),
    );
  });

  it('ignores forbidden text inside comments, strings and regular expressions', () => {
    assertClean(
      lint('domain', {
        'domain/a.ts': [
          "// import fs from 'node:fs';",
          "/* require('node:child_process'); process.exit(1); createRequire */",
          "export const s = \"import x from 'node:fs'; process.env\";",
          "export const t = `import('node:fs') ${1 + 1} process.env`;",
          "export const r = /['\"]process\\.env/;",
          'export const u = "http://example.test/a//b";',
          '',
        ].join('\n'),
      }),
    );
  });

  it('still finds a violation after a regular expression, a template and a division', () => {
    assertViolation(
      lint('domain', {
        'domain/a.ts': "const re = /a['\"]b/g;\nconst t = `x${1 / 2}y`;\nconst d = 4 / 2;\nimport 'node:fs';\n",
      }),
      'forbidden-import',
      'node:fs',
    );
  });

  it('reports every violation and the count, not just the first', () => {
    const run = lint('domain', { 'domain/a.ts': "import 'node:fs';\nimport 'node:os';\nimport 'left-pad';\n" });
    assert.equal(run.status, 1);
    assert.equal(run.stdout.split('\n').filter((l) => / forbidden-import /.test(l)).length, 3);
    assert.match(run.stdout, /3 violation\(s\)/);
  });
});

describe('check-boundaries: ports rules', () => {
  it('fails a ports file importing an adapter, a node module or a package', () => {
    assertViolation(lint('ports', { 'ports/a.ts': "import { x } from '../adapters/x.ts';\n" }), 'layer-escape');
    assertViolation(lint('ports', { 'ports/a.ts': "import 'node:crypto';\n" }), 'forbidden-import', 'node:crypto');
    assertViolation(lint('ports', { 'ports/a.ts': "import x from 'left-pad';\n" }), 'forbidden-import');
  });

  it('passes a ports file importing from ports and from the sibling domain', () => {
    assertClean(
      lint('ports', {
        'ports/a.ts': "import type { R } from '../domain/result.ts';\nimport type { B } from './b.ts';\nexport type A = [R, B];\n",
        'ports/b.ts': 'export type B = 1;\n',
        'domain/result.ts': 'export type R = 2;\n',
      }),
    );
  });
});

describe('check-boundaries: app rules', () => {
  it('fails an app file importing an adapter or the cli, at any depth', () => {
    assertViolation(lint('app', { 'app/a.ts': "import { x } from '../adapters/sqlite/x.ts';\n" }), 'layer-escape');
    assertViolation(lint('app', { 'app/stages/a.ts': "import { x } from '../../cli/main.ts';\n" }), 'layer-escape');
  });

  it('passes an app file importing domain, ports and node modules', () => {
    assertClean(
      lint('app', {
        'app/a.ts': "import { x } from '../domain/x.ts';\nimport type { P } from '../ports/p.ts';\nimport { join } from 'node:path';\nexport const a = [x, join];\nexport type Q = P;\n",
      }),
    );
  });

  it('still fails a non-literal import() and createRequire in app code', () => {
    assertViolation(lint('app', { 'app/a.ts': 'export const f = (n: string) => import(n);\n' }), 'dynamic-import');
    assertViolation(lint('app', { 'app/b.ts': 'const r = createRequire(x);\n' }), 'create-require');
  });
});

describe('check-boundaries: command line and repository', () => {
  it('exits 0 on the repository itself (src/domain, src/ports, src/app)', () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', cwd: REPO });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /ok \(\d+ file\(s\)\)/);
  });

  it('exits 2 on an unknown argument, an unknown kind and a missing directory', () => {
    for (const args of [['--bogus'], ['--root-as', 'nope', scratch], ['--root-as', 'domain', join(scratch, 'does-not-exist')]]) {
      const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: REPO });
      assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    }
  });
});
