// The cache rule (plan 04-28; CON-12, T-04-79; docs/containment.md "Retrieval and resource safeguards"): a cache stores the source version, the retrieval time, the profile
// and the access scope with each item, and an item is not reused after its source returns `denied` or `unauthenticated`, after the access scope changes, or in another
// profile. Pure: it judges entries against what is true now and reads nothing.
//
// An entry that may not be reused is refetched, never repaired: its excerpt is not carried into the new pack. A revision that differs is a miss too, because the text was
// read at another version of the source.

// The part of an ExternalRef the rule reads; an ExternalRef is one.
export interface CacheRef {
  revision?: string;
  freshness: string;
}

// The format a pack item is stamped with (GIN-05; CON-12). An item carries the flags the adapters set when it was read (untrusted, codeNode), and a reused item skips that read, so
// an item built by an older adapter keeps its old flags. Raise this whenever an adapter changes which flags an item carries: an item with an absent or different format is a miss
// and is read again.
export const PACK_ITEM_FORMAT = 1;

// One cached item: what it cites, the profile and access scope it was fetched under, the item format it was built in (absent: before items were stamped) and what its source
// last answered about it (absent: the answer was an item).
export interface CacheEntry {
  ref: CacheRef;
  profile: string;
  accessScope: string;
  format?: number;
  answer?: 'ok' | 'denied' | 'unauthenticated';
}

// What is true now: the profile asking, the access scope it asks under (a digest of what it may read), the item format the adapters build now and the revision the source is at.
export interface CacheNow {
  profile: string;
  accessScope: string;
  format: number;
  revision: string;
}

export type CacheMiss = 'profile' | 'access-scope' | 'format' | 'revision' | 'access_revoked';

// A reference whose access was revoked: its freshness says so.
export function isRevoked(ref: CacheRef): boolean {
  return ref.freshness === 'access_revoked';
}

// Why an entry may not be reused, or null when it may. Revocation is judged first: an entry the source refused is never reusable whatever else holds, and the reason a
// reader needs is that access went away. The format is judged after the profile and the access scope and before the revision, because an item of an older build is wrong
// whatever revision it was read at.
export function cacheMiss(entry: CacheEntry, now: CacheNow): CacheMiss | null {
  if (isRevoked(entry.ref) || entry.answer === 'denied' || entry.answer === 'unauthenticated') return 'access_revoked';
  if (entry.profile !== now.profile) return 'profile';
  if (entry.accessScope !== now.accessScope) return 'access-scope';
  if (entry.format !== now.format) return 'format';
  if (entry.ref.revision === undefined || entry.ref.revision !== now.revision) return 'revision';
  return null;
}

export function mayReuse(entry: CacheEntry, now: CacheNow): boolean {
  return cacheMiss(entry, now) === null;
}

// The entries that may be reused, in their order, and the others with the reason each is refetched.
export function reusablePack<E extends CacheEntry>(previous: readonly E[], now: CacheNow): { reusable: E[]; refetch: Array<{ entry: E; reason: CacheMiss }> } {
  const reusable: E[] = [];
  const refetch: Array<{ entry: E; reason: CacheMiss }> = [];
  for (const entry of previous) {
    const miss = cacheMiss(entry, now);
    if (miss === null) reusable.push(entry);
    else refetch.push({ entry, reason: miss });
  }
  return { reusable, refetch };
}
