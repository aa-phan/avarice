// One check for every root the domain is handed as a plain string (the invocation scope's work root, the extraction plan's corpus
// root): a normalized absolute path below `/`. String operations only: the domain may import nothing but relative paths and node:crypto.

// Thrown for a root that fails the check. It is a TypeError (and keeps that name), so existing callers that look for one still match;
// a caller that means to turn exactly this refusal into a typed result tests for this class and lets any other throw through (IN-04).
export class RootRefusedError extends TypeError {}

export const trimTrailingSlashes = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, '') : path);

// Judges the trimmed value (`//` trims to ''), returns it, and throws a RootRefusedError, `{label} must be a normalized absolute path
// below '/', got ...`, for anything that is not an absolute path made of non-empty, non-`.`, non-`..` segments.
export function normalizedAbsoluteRoot(value: unknown, label: string): string {
  const refuse = (): never => {
    const got = typeof value === 'string' ? JSON.stringify(value) : `a value of type ${typeof value}`;
    throw new RootRefusedError(`${label} must be a normalized absolute path below '/', got ${got}`);
  };
  if (typeof value !== 'string') return refuse();
  const trimmed = trimTrailingSlashes(value);
  if (!trimmed.startsWith('/') || trimmed === '/') return refuse();
  if (trimmed.slice(1).split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) return refuse();
  return trimmed;
}
