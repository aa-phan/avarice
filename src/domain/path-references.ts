// Path references named in map documents (docs/repository-onboarding.md "Validation", Path references): the
// paths a document names must exist at the stamped revision, up to a configurable share of dangling ones.
// Prose is noisy, so extraction is deliberately narrow:
//   - frontmatter and fenced code blocks are skipped (tree drawings and sample code name paths relatively);
//   - a backticked token counts when it contains a slash or ends in a known source or config extension;
//   - a bare token counts only when it contains a slash and either ends in `/` or ends in a known extension,
//     so `and/or` and `Node.js` in running text are not references;
//   - URLs, globs, placeholders, MIME types, npm scopes, absolute and home paths are ignored; a trailing
//     `:line` or `#anchor` is removed.
// Pure: knownPaths is an argument.

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
  const counts = backticked ? hasSlash || knownExtension : hasSlash && (trailingSlash || knownExtension);
  if (!counts) return null;
  path = segments.join('/');
  return path;
}

// Unique, normalized references in first-seen order.
export function extractPathReferences(markdown: string): string[] {
  const seen = new Set<string>();
  for (const line of withoutFences(stripFrontmatter(markdown))) {
    for (const span of line.matchAll(/`([^`\n]+)`/g)) {
      const ref = normalize(span[1] as string, true);
      if (ref !== null) seen.add(ref);
    }
    for (const word of line.replace(/`[^`\n]*`/g, ' ').split(/\s+/)) {
      if (word.length === 0) continue;
      const ref = normalize(word, false);
      if (ref !== null) seen.add(ref);
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

// A reference resolves when it is a known file, a directory containing a known file, or (with no slash) the
// name of a known file somewhere in the tree.
export function danglingShare(refs: readonly string[], knownPaths: Iterable<string>): DanglingResult {
  const files = new Set<string>();
  const directories = new Set<string>();
  const names = new Set<string>();
  for (const known of knownPaths) {
    files.add(known);
    const parts = known.split('/');
    names.add(parts.at(-1) as string);
    for (let i = 1; i < parts.length; i += 1) directories.add(parts.slice(0, i).join('/'));
  }
  const unique = [...new Set(refs)];
  const dangling = unique.filter((ref) => !(files.has(ref) || directories.has(ref) || (!ref.includes('/') && names.has(ref))));
  return { total: unique.length, dangling, share: unique.length === 0 ? 0 : dangling.length / unique.length };
}
