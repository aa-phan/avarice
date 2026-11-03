// Path references named in map documents (docs/repository-onboarding.md "Validation", Path references): the
// paths a document names must exist at the stamped revision, up to a configurable share of dangling ones.
// Prose is noisy, so extraction is deliberately narrow:
//   - frontmatter and fenced code blocks are skipped (tree drawings and sample code name paths relatively);
//   - a backticked token counts when it contains a slash or ends in a known source or config extension;
//   - a bare token counts only when it contains a slash and either ends in `/` or ends in a known extension,
//     so `and/or` and `Node.js` in running text are not references;
//   - URLs, globs, placeholders, MIME types, npm scopes, absolute and home paths are ignored; a trailing
//     `:line` or `#anchor` is removed;
//   - names that merely look like paths are ignored: a bare extension (`.ts`), a `name@version` token
//     (`actions/checkout@v4`), a dotted identifier (`process.env`, `res.json`);
//   - a clause that says the thing is absent, or ignored by git ("there is no X", "not present", "does not
//     exist", "without a .env", "`.gitignore` excludes X") names nothing that must exist, so its paths are skipped.
// A real path that does not exist, named in a neutral clause, still counts and still dangles.
// Pure: knownPaths is an argument.

import { matchesAny } from './glob.ts';

const KNOWN_EXTENSIONS: ReadonlySet<string> = new Set([
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonc', 'md', 'mdx', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'py', 'go', 'rs', 'java', 'kt', 'kts', 'rb', 'php', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'swift', 'scala', 'ex', 'exs', 'sh',
  'bash', 'zsh', 'sql', 'css', 'scss', 'sass', 'less', 'html', 'vue', 'svelte', 'xml', 'gradle', 'lock', 'txt', 'env', 'proto',
  'graphql', 'tf', 'dockerfile', 'mod', 'sum',
]);

// Product and library names written like file names.
const PRODUCT_NAMES: ReadonlySet<string> = new Set([
  'node.js', 'next.js', 'nuxt.js', 'vue.js', 'react.js', 'express.js', 'nest.js', 'three.js', 'd3.js', 'ember.js', 'backbone.js',
  'angular.js', 'alpine.js', 'chart.js', 'moment.js', 'p5.js', 'deno.js', 'bun.js', 'socket.io', 'asp.net', '.net',
]);

// `.env` is a file name; every other known extension written alone (`.ts`, `.json`) is an extension, not a file.
const DOTFILE_EXTENSIONS: ReadonlySet<string> = new Set(['env']);

// Roots of member accesses that end in a known extension (`res.json`, `process.env`, `import.meta.env`).
const MEMBER_ROOTS: ReadonlySet<string> = new Set([
  'process', 'import.meta', 'res', 'req', 'response', 'request', 'window', 'document', 'globalthis', 'console', 'deno', 'bun',
]);

// A clause (a sentence, a `;` part or a table cell) that states its subject is absent, or is ignored by git.
const ABSENCE_CLAUSE: readonly RegExp[] = [
  /\bthere\s+(?:is|are|was|were)\s+no\b/i,
  /\bno\s+(?:[\w-]+\s+){0,2}?`/i,
  /\bno\s+(?:such\s+)?(?:file|directory|folder|dir|path)s?\b/i,
  /\bnot\s+(?:present|found|tracked|committed)\b/i,
  /\b(?:does|do|did)\s+not\s+exist\b|\bdoesn'?t\s+exist\b/i,
  /\babsent\b/i,
  /\bwithout\b/i,
  /\b(?:git-?ignored|ignored\s+by|untracked|excluded\s+from|excludes?)\b/i,
];

const MIME_TYPES: ReadonlySet<string> = new Set(['application', 'text', 'image', 'audio', 'video', 'multipart', 'font', 'message', 'model']);

function stripFrontmatter(markdown: string): string {
  const text = markdown.replaceAll('\r\n', '\n');
  if (!text.startsWith('---\n')) return text;
  const end = text.indexOf('\n---', 4);
  return end === -1 ? text : text.slice(text.indexOf('\n', end + 1) + 1);
}

function withoutFences(text: string): string[] {
  const kept: string[] = [];
  let fence: string | null = null;
  for (const line of text.split('\n')) {
    const marker = /^\s*(```+|~~~+)/.exec(line);
    if (fence === null && marker !== null) {
      fence = (marker[1] as string)[0] as string;
      continue;
    }
    if (fence !== null) {
      if (marker !== null && (marker[1] as string)[0] === fence) fence = null;
      continue;
    }
    kept.push(line);
  }
  return kept;
}

function normalize(raw: string, backticked: boolean): string | null {
  const token = raw
    .trim()
    .replace(/^[("'[<]+/, '')
    .replace(/[)"'\]>,;:!?.]+$/, '')
    .replace(/#.*$/, '')
    .replace(/:\d+(?:[-:]\d+)*$/, '')
    .replace(/[:.]+$/, '');
  if (token.length === 0 || /\s/.test(token) || /[*?{}<>$|=\\]/.test(token)) return null;
  if (token.includes('://') || token.includes('...') || /^(?:www\.|mailto:)/i.test(token)) return null;
  // `name@version`: an `@` inside a segment (a scope `@types/node` starts its segment and stays a path).
  if (/[^/]@/.test(token)) return null;
  if (/^[/~@#-]/.test(token) || token.startsWith('../')) return null;
  if (PRODUCT_NAMES.has(token.toLowerCase())) return null;

  const trailingSlash = token.endsWith('/');
  let path = token.replace(/^(?:\.\/)+/, '').replace(/\/+$/, '');
  if (path.length === 0) return null;
  const segments = path.split('/');
  if (segments.some((s) => s === '.' || s === '..' || !/^[A-Za-z0-9._+@-]+$/.test(s))) return null;
  if (segments.length === 2 && MIME_TYPES.has((segments[0] as string).toLowerCase())) return null;

  const hasSlash = segments.length > 1 || trailingSlash;
  const extension = /\.([A-Za-z0-9]+)$/.exec(segments.at(-1) as string)?.[1]?.toLowerCase();
  const knownExtension = extension !== undefined && KNOWN_EXTENSIONS.has(extension);
  if (!hasSlash && extension !== undefined) {
    const stem = (segments[0] as string).slice(0, -(extension.length + 1));
    if (stem === '' && !DOTFILE_EXTENSIONS.has(extension)) return null;
    if (stem !== '' && MEMBER_ROOTS.has(stem.toLowerCase())) return null;
  }
  const counts = backticked ? hasSlash || knownExtension : hasSlash && (trailingSlash || knownExtension);
  if (!counts) return null;
  path = segments.join('/');
  return path;
}

// The clauses of a line: split at `;`, at a table cell border and after a sentence end.
function clausesOf(line: string): string[] {
  return line.split(/[;|]|(?<=[.!?])\s+(?=[A-Z`(])/).filter((c) => c.trim() !== '');
}

// Unique, normalized references in first-seen order.
export function extractPathReferences(markdown: string): string[] {
  const seen = new Set<string>();
  for (const line of withoutFences(stripFrontmatter(markdown))) {
    for (const clause of clausesOf(line)) {
      if (ABSENCE_CLAUSE.some((pattern) => pattern.test(clause))) continue;
      for (const span of clause.matchAll(/`([^`\n]+)`/g)) {
        const ref = normalize(span[1] as string, true);
        if (ref !== null) seen.add(ref);
      }
      for (const word of clause.replace(/`[^`\n]*`/g, ' ').split(/\s+/)) {
        if (word.length === 0) continue;
        const ref = normalize(word, false);
        if (ref !== null) seen.add(ref);
      }
    }
  }
  return [...seen];
}

export interface DanglingResult {
  total: number;
  dangling: string[];
  // dangling / total; 0 when there are no references.
  share: number;
}

// A reference resolves when it is a known file, a directory containing a known file, matches an own glob (the
// paths AVARICE itself writes in staging, `dir/**` covers the directory and what lies below it), or (with no
// slash) is the name of a known file or directory somewhere in the tree.
export function danglingShare(refs: readonly string[], knownPaths: Iterable<string>, ownGlobs: readonly string[] = []): DanglingResult {
  const files = new Set<string>();
  const directories = new Set<string>();
  const names = new Set<string>();
  for (const known of knownPaths) {
    files.add(known);
    const parts = known.split('/');
    names.add(parts.at(-1) as string);
    for (let i = 1; i < parts.length; i += 1) {
      directories.add(parts.slice(0, i).join('/'));
      names.add(parts[i - 1] as string);
    }
  }
  // The directories on the way to an own glob (`.claude` for `.claude/.cc-writes/**`) exist in staging too.
  for (const glob of ownGlobs) {
    const parts = glob.replace(/[*?].*$/, '').split('/').filter((part) => part !== '');
    for (let i = 1; i <= parts.length; i += 1) directories.add(parts.slice(0, i).join('/'));
  }
  const unique = [...new Set(refs)];
  const dangling = unique.filter(
    (ref) => !(files.has(ref) || directories.has(ref) || (!ref.includes('/') && names.has(ref)) || matchesAny(ref, ownGlobs)),
  );
  return { total: unique.length, dangling, share: unique.length === 0 ? 0 : dangling.length / unique.length };
}
