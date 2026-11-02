export const ID_PREFIXES: readonly string[] = [];
export type IdPrefix = string;
export function ulid(_nowMs: number, _randomBytes: Uint8Array): string {
  throw new Error('not implemented');
}
export function newId(_prefix: IdPrefix, _nowMs: number, _randomBytes: Uint8Array): string {
  throw new Error('not implemented');
}
