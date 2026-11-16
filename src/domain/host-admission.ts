// Host admission (D-20, OPS-6). Stub for the RED step: the exports exist, the predicate admits nothing.
export const VERIFIED_HOST_VERSIONS: readonly string[] = ['2.1.312', '2.1.316', '2.1.317', '2.1.318', '2.1.319'];
export const VERIFIED_MINORS: Readonly<Record<string, number>> = { '2.1': 312 };
export const REQUIRED_HELP_FLAGS: readonly string[] = [
  '--setting-sources',
  '--permission-prompts',
  '--permission-mode',
  '--max-budget-usd',
  '--settings',
  '--plugin-dir',
  '--agents',
];

export type HostAdmission = 'verified' | 'unverified-patch';
export type HostRefusal = 'host-minor-unverified' | 'host-patch-below-range' | 'host-version-unknown';

export function compareVersions(_a: string, _b: string): number {
  return Number.NaN;
}

export function admitHostVersion(_version: string): { admission: HostAdmission } | { refused: HostRefusal } {
  return { refused: 'host-version-unknown' };
}
