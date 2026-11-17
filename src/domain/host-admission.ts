// Host admission by patch range (D-20, OPS-6; docs/decisions/ADR-014-host-patch-admission.md). A pure predicate over the
// version `claude --version` reports. A version in the verified list ran the live containment suite. A patch of a verified
// minor, at or above that minor's lowest verified patch, is admitted as unverified once the launch probes pass (the preflight
// runs them; this module only judges the number). Every other version is refused until a live run admits it.

// Versions a live T3 run was recorded on with 0 containment failures (test/containment/LIVE-CASES.md). A version is added
// only after such a run.
export const VERIFIED_HOST_VERSIONS: readonly string[] = ['2.1.312', '2.1.316', '2.1.317', '2.1.318', '2.1.319'];

// The lowest verified patch of each verified minor. A patch below it is refused: it predates every live run of that minor.
export const VERIFIED_MINORS: Readonly<Record<string, number>> = { '2.1': 312 };

// Flags the launch line uses and the installed host listed in `claude --help` (spike S4-C). An unverified patch that no longer
// lists one is refused: the host dropped or renamed a flag containment depends on.
export const REQUIRED_HELP_FLAGS: readonly string[] = [
  '--setting-sources',
  '--permission-prompts',
  '--permission-mode',
  '--max-budget-usd',
  '--settings',
  '--plugin-dir',
  '--agents',
];

// Flags the restricted launch line uses (plan 04-23; spike S4-C). `--restricted` comes first, so a host that dropped it is refused as
// `host-flag-missing:--restricted`. The restricted line carries no plugin directory and no agents file, so those two are not required.
export const RESTRICTED_HELP_FLAGS: readonly string[] = [
  '--restricted',
  '--settings',
  '--setting-sources',
  '--permission-mode',
  '--permission-prompts',
  '--max-budget-usd',
];

export type HostAdmission = 'verified' | 'unverified-patch';
export type HostRefusal = 'host-minor-unverified' | 'host-patch-below-range' | 'host-version-unknown';

// `major.minor.patch`, decimal digits only. Anything else (a prefix, a suffix, a fourth component) is not a version here.
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

function parse(version: string): [number, number, number] | undefined {
  const match = VERSION.exec(version);
  if (match === null) return undefined;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])] as [number, number, number];
  return parts.every((part) => Number.isSafeInteger(part)) ? parts : undefined;
}

// Compares per component as numbers, so 2.1.100 is above 2.1.99. NaN when either side is not a version.
export function compareVersions(a: string, b: string): number {
  const left = parse(a);
  const right = parse(b);
  if (left === undefined || right === undefined) return Number.NaN;
  for (let i = 0; i < 3; i += 1) {
    const difference = (left[i] as number) - (right[i] as number);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function admitHostVersion(version: string): { admission: HostAdmission } | { refused: HostRefusal } {
  const parsed = parse(version);
  if (parsed === undefined) return { refused: 'host-version-unknown' };
  if (VERIFIED_HOST_VERSIONS.some((verified) => compareVersions(verified, version) === 0)) return { admission: 'verified' };
  const lowest = VERIFIED_MINORS[`${parsed[0]}.${parsed[1]}`];
  if (lowest === undefined) return { refused: 'host-minor-unverified' };
  if (parsed[2] < lowest) return { refused: 'host-patch-below-range' };
  return { admission: 'unverified-patch' };
}
