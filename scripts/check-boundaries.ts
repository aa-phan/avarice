// Import-boundary lint (NFR-3, SKELETON.md "Import boundary"). Zero dependencies: TypeScript 7 has no
// JavaScript API, so this reads source text. Run: node scripts/check-boundaries.ts
//
//   node scripts/check-boundaries.ts                         checks src/domain, src/ports and src/app
//   node scripts/check-boundaries.ts --root-as domain DIR    checks DIR with the domain rules
//
// Rules (a missing default directory is skipped, so later plans' files are checked as they land):
//   domain  imports only relative paths inside the directory, plus node:crypto; no `process` access
//   ports   imports only relative paths inside the directory or the sibling domain directory
//   app     imports nothing that resolves into the sibling adapters or cli directories
//   all     dynamic import() / require() need a single string-literal argument; createRequire is banned
//
// Output: one `file:line rule specifier` line per violation; exit 1 when any exist, 2 on a usage or
// read error. The lint is a control, so test/unit/boundaries.test.ts proves each rule with generated files.
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

type Kind = 'domain' | 'ports' | 'app';

interface Violation {
  file: string;
  line: number;
  rule: string;
  specifier: string;
}

const SOURCE_FILE = /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/;
const REGEX_PRECEDING_WORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);

// ---------------------------------------------------------------------------
// Source scanning: blank comments, and (in a second copy) string, template and regex bodies, keeping
// every character offset and newline, so keyword searches ignore text that is not code while
// specifiers are still read from the copy that keeps string contents.
// ---------------------------------------------------------------------------
interface Scanned {
  withStrings: string;
  codeOnly: string;
}

function scan(source: string): Scanned {
  const n = source.length;
  const withStrings = source.split('');
  const codeOnly = source.split('');
  let prev = '';

  const blank = (arr: string[], from: number, to: number): void => {
    for (let k = from; k < to; k++) if (arr[k] !== '\n') arr[k] = ' ';
  };

  const wordBefore = (end: number): string => {
    let k = end;
    while (k > 0 && /[\w$]/.test(source[k - 1] ?? '')) k--;
    return source.slice(k, end);
  };

  // Scans code from i. When stopAtBrace is set, returns at the `}` that closes the enclosing `${`.
  function scanCode(start: number, stopAtBrace: boolean): number {
    let i = start;
    let depth = 0;
    while (i < n) {
      const c = source[i] as string;
      const d = source[i + 1];
      if (c === '/' && d === '/') {
        let j = i;
        while (j < n && source[j] !== '\n') j++;
        blank(withStrings, i, j);
        blank(codeOnly, i, j);
        i = j;
      } else if (c === '/' && d === '*') {
        const end = source.indexOf('*/', i + 2);
        const j = end === -1 ? n : end + 2;
        blank(withStrings, i, j);
        blank(codeOnly, i, j);
        i = j;
      } else if (c === "'" || c === '"') {
        let j = i + 1;
        while (j < n && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
        blank(codeOnly, i + 1, Math.min(j, n));
        i = source[j] === c ? j + 1 : j;
        prev = c;
      } else if (c === '`') {
        i = scanTemplate(i);
        prev = '`';
      } else if (c === '/' && isRegexStart(i)) {
        let j = i + 1;
        let inClass = false;
        let closed = false;
        while (j < n && source[j] !== '\n') {
          const ch = source[j];
          if (ch === '\\') j += 2;
          else {
            if (ch === '[') inClass = true;
            else if (ch === ']') inClass = false;
            else if (ch === '/' && !inClass) {
              closed = true;
              break;
            }
            j++;
          }
        }
        if (closed) {
          blank(codeOnly, i + 1, j);
          i = j + 1;
          while (i < n && /[a-z]/.test(source[i] ?? '')) i++;
          prev = '/';
        } else {
          prev = c;
          i++;
        }
      } else {
        if (stopAtBrace) {
          if (c === '{') depth++;
          else if (c === '}') {
            if (depth === 0) return i;
            depth--;
          }
        }
        if (!/\s/.test(c)) prev = c;
        i++;
      }
    }
    return i;
  }

  function isRegexStart(i: number): boolean {
    if (prev === '') return true;
    if (/[\w$]/.test(prev)) return REGEX_PRECEDING_WORDS.has(wordBefore(precedingEnd(i)));
    return '(,=:[!&|?{};+-*%<>~^'.includes(prev);
  }

  // Offset just after the last non-whitespace character before i.
  function precedingEnd(i: number): number {
    let k = i;
    while (k > 0 && /\s/.test(source[k - 1] ?? '')) k--;
    return k;
  }

  function scanTemplate(start: number): number {
    let j = start + 1;
    while (j < n && source[j] !== '`') {
      if (source[j] === '\\') {
        blank(codeOnly, j, Math.min(j + 2, n));
        j += 2;
      } else if (source[j] === '$' && source[j + 1] === '{') {
        blank(codeOnly, j, j + 2);
        const saved = prev;
        prev = '{';
        const close = scanCode(j + 2, true);
        prev = saved;
        j = close + 1;
      } else {
        blank(codeOnly, j, j + 1);
        j++;
      }
    }
    return Math.min(j + 1, n);
  }

  scanCode(0, false);
  return { withStrings: withStrings.join(''), codeOnly: codeOnly.join('') };
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------
interface Found {
  offset: number;
  rule: string;
  specifier: string;
  isSpecifier: boolean;
}

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let k = 0; k < offset && k < text.length; k++) if (text[k] === '\n') line++;
  return line;
}

// Reads a string literal whose opening quote is at `quoteAt` (offsets are shared between both copies).
function readLiteral(s: Scanned, quoteAt: number): { value: string; end: number } | null {
  const quote = s.codeOnly[quoteAt];
  if (quote !== "'" && quote !== '"') return null;
  const close = s.codeOnly.indexOf(quote, quoteAt + 1);
  if (close === -1) return null;
  return { value: s.withStrings.slice(quoteAt + 1, close), end: close + 1 };
}

function extract(s: Scanned): Found[] {
  const found: Found[] = [];
  const code = s.codeOnly;

  // import ... from '...'   export ... from '...'
  for (const m of code.matchAll(/(?<![\w$.])(?:import|export)(?![\w$])[^;'"`]*?(?<![\w$])from\s*(?=['"])/g)) {
    const quoteAt = m.index + m[0].length;
    const lit = readLiteral(s, quoteAt);
    if (lit) found.push({ offset: quoteAt, rule: 'static', specifier: lit.value, isSpecifier: true });
  }

  // import '...'
  for (const m of code.matchAll(/(?<![\w$.])import\s*(?=['"])/g)) {
    const quoteAt = m.index + m[0].length;
    const lit = readLiteral(s, quoteAt);
    if (lit) found.push({ offset: quoteAt, rule: 'static', specifier: lit.value, isSpecifier: true });
  }

  // import(...) and require(...): the argument must be one string literal.
  for (const [pattern, rule] of [
    [/(?<![\w$])import\s*\(/g, 'dynamic-import'],
    [/(?<![\w$])require\s*\(/g, 'dynamic-require'],
  ] as const) {
    for (const m of code.matchAll(pattern)) {
      let p = m.index + m[0].length;
      while (p < code.length && /\s/.test(code[p] ?? '')) p++;
      const lit = readLiteral(s, p);
      let ok = false;
      if (lit) {
        let q = lit.end;
        while (q < code.length && /\s/.test(code[q] ?? '')) q++;
        ok = code[q] === ')' || code[q] === ',';
      }
      if (lit && ok) found.push({ offset: p, rule: 'static', specifier: lit.value, isSpecifier: true });
      else found.push({ offset: m.index, rule, specifier: '<non-literal>', isSpecifier: false });
    }
  }

  for (const m of code.matchAll(/(?<![\w$])createRequire(?![\w$])/g)) {
    found.push({ offset: m.index, rule: 'create-require', specifier: 'createRequire', isSpecifier: false });
  }

  return found;
}

function processAccess(s: Scanned): Found[] {
  const found: Found[] = [];
  for (const m of s.codeOnly.matchAll(/(?<![\w$.])process\s*[.[]|(?<![\w$])globalThis\s*\.\s*process(?![\w$])/g)) {
    found.push({ offset: m.index, rule: 'process-access', specifier: 'process', isSpecifier: false });
  }
  return found;
}

// ---------------------------------------------------------------------------
// Layer rules
// ---------------------------------------------------------------------------
const isRelative = (spec: string): boolean => spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..';

function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
}

interface Layer {
  kind: Kind;
  root: string;
}

function layerViolation(layer: Layer, file: string, spec: string): string | null {
  const srcRoot = dirname(layer.root);
  if (layer.kind === 'domain') {
    if (spec === 'node:crypto') return null;
    if (!isRelative(spec)) return 'forbidden-import';
    return inside(layer.root, resolve(dirname(file), spec)) ? null : 'layer-escape';
  }
  if (layer.kind === 'ports') {
    if (!isRelative(spec)) return 'forbidden-import';
    const target = resolve(dirname(file), spec);
    return inside(layer.root, target) || inside(join(srcRoot, 'domain'), target) ? null : 'layer-escape';
  }
  if (!isRelative(spec)) return null;
  const target = resolve(dirname(file), spec);
  return inside(join(srcRoot, 'adapters'), target) || inside(join(srcRoot, 'cli'), target) ? 'layer-escape' : null;
}

function checkFile(layer: Layer, file: string, display: string, out: Violation[]): void {
  const source = readFileSync(file, 'utf8');
  const scanned = scan(source);
  const found = extract(scanned);
  if (layer.kind === 'domain') found.push(...processAccess(scanned));
  for (const f of found) {
    let rule = f.rule;
    if (f.rule === 'static') {
      const v = layerViolation(layer, file, f.specifier);
      if (v === null) continue;
      rule = v;
    }
    out.push({ file: display, line: lineOf(source, f.offset), rule, specifier: f.specifier });
  }
}

function walk(dir: string, files: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules') continue;
    const full = join(dir, name);
    const st = lstatSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (st.isFile() && SOURCE_FILE.test(name)) files.push(full);
    else if (st.isSymbolicLink() && SOURCE_FILE.test(name)) files.push(full);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
function usage(message: string): never {
  console.error(`check-boundaries: ${message}`);
  console.error('usage: node scripts/check-boundaries.ts [--root-as domain|ports|app DIR]...');
  process.exit(2);
}

function main(argv: string[]): void {
  const layers: Layer[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg !== '--root-as') usage(`unknown argument ${JSON.stringify(arg)}`);
    const kind = argv[i + 1];
    const dir = argv[i + 2];
    if (kind !== 'domain' && kind !== 'ports' && kind !== 'app') usage('--root-as needs domain, ports or app');
    if (dir === undefined) usage('--root-as needs a directory');
    const root = resolve(dir);
    if (!existsSync(root) || !lstatSync(root).isDirectory()) usage(`not a directory: ${dir}`);
    layers.push({ kind, root });
    i += 2;
  }
  if (layers.length === 0) {
    const repo = resolve(import.meta.dirname, '..');
    for (const [kind, sub] of [
      ['domain', 'src/domain'],
      ['ports', 'src/ports'],
      ['app', 'src/app'],
    ] as const) {
      const root = join(repo, sub);
      if (existsSync(root)) layers.push({ kind, root });
    }
  }

  const violations: Violation[] = [];
  let checked = 0;
  for (const layer of layers) {
    const files: string[] = [];
    walk(layer.root, files);
    for (const file of files) {
      try {
        checkFile(layer, file, relative(process.cwd(), file) || file, violations);
      } catch (e) {
        console.error(`check-boundaries: cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(2);
      }
      checked++;
    }
  }

  violations.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  for (const v of violations) console.log(`${v.file}:${v.line} ${v.rule} ${v.specifier}`);
  if (violations.length > 0) {
    console.log(`check-boundaries: ${violations.length} violation(s) in ${checked} file(s)`);
    process.exit(1);
  }
  console.log(`check-boundaries: ok (${checked} file(s))`);
}

main(process.argv.slice(2));
