// Skeleton of plan 04-28 task 3 (CON-12): the cache rule is not built yet; everything may be reused.

// The part of an ExternalRef the rule reads; an ExternalRef is one.
export interface CacheRef {
  revision?: string;
  freshness: string;
}

export interface CacheEntry {
  ref: CacheRef;
  profile: string;
  accessScope: string;
  answer?: 'ok' | 'denied' | 'unauthenticated';
}

export interface CacheNow {
  profile: string;
  accessScope: string;
  revision: string;
}

export type CacheMiss = 'profile' | 'access-scope' | 'revision' | 'access_revoked';

export function isRevoked(_ref: CacheRef): boolean {
  return false;
}

export function mayReuse(_entry: CacheEntry, _now: CacheNow): boolean {
  return true;
}

export function reusablePack<E extends CacheEntry>(previous: readonly E[], _now: CacheNow): { reusable: E[]; refetch: Array<{ entry: E; reason: CacheMiss }> } {
  return { reusable: [...previous], refetch: [] };
}
