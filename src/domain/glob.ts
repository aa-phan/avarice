// Path globs for write sets (docs/repository-onboarding.md "Onboarding contract" files.write). Pure and
// deliberately small: `**` matches any number of path segments (including none after a directory), `*` and `?`
// stay inside one segment, everything else is literal. A glob `dir/**` matches `dir` itself and anything below
// it, never a sibling that merely shares the prefix (`dir-other/x`).
const cache = new Map<string, RegExp>();

function escapeChar(char: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
}

export function globToRegExp(glob: string): RegExp {
  const cached = cache.get(glob);
  if (cached !== undefined) return cached;
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i] as string;
    if (char === '*' && glob[i + 1] === '*') {
      const before = i === 0 || glob[i - 1] === '/';
      const after = glob[i + 2];
      if (before && after === '/') {
        source += '(?:.*/)?';
        i += 2;
      } else if (i > 0 && glob[i - 1] === '/' && after === undefined) {
        // `dir/**`: the directory itself and everything below it.
        source = source.slice(0, -1) + '(?:/.*)?';
        i += 1;
      } else {
        source += '.*';
        i += 1;
      }
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += escapeChar(char);
    }
  }
  const regexp = new RegExp(`^${source}$`);
  cache.set(glob, regexp);
  return regexp;
}

export function matchesGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(path);
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(path, glob));
}
