// The GSD version line AVARICE's onboarding adapter admits (ONB-12, S-38): @opengsd/gsd-core 1.17.x. Pure rules over a version string, shared by the
// locator (which refuses a gsd-core outside the line), `doctor` (which reports one) and `start` (which refuses a run on a record built under another line).
// GSD_ADMITTED_RANGE in the GSD port is the human-readable form of the same line.

const ADMITTED_VERSION = /^1\.17\.\d+$/;
const MINOR_OF = /^(\d+)\.(\d+)\.\d+/;

// Whether `version` is a gsd-core version the adapter admits.
export function gsdVersionAdmitted(version: string): boolean {
  return ADMITTED_VERSION.test(version);
}

// `major.minor` of a version (`1.17.0` is `1.17`), or undefined for text that is not a version (the record's `unknown`).
export function gsdMinorOf(version: string): string | undefined {
  const match = MINOR_OF.exec(version);
  return match === null ? undefined : `${match[1] ?? ''}.${match[2] ?? ''}`;
}
