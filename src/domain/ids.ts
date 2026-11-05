// Identifiers (docs/contracts-and-state.md "Correlation identifiers"; SKELETON.md "IDs").
// ULID: 48-bit millisecond time + 80 random bits, Crockford base32, 26 characters.
// Time and randomness are arguments so the domain never reads a clock or a random source.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const MAX_TIME_MS = 2 ** 48 - 1;
const RANDOM_BYTES = 10;

export const ID_PREFIXES = ['proj_', 'onb_', 'run_', 'inv_', 'att_', 'ckp_', 'ev_', 'dec_'] as const;
export type IdPrefix = (typeof ID_PREFIXES)[number];

function encode(value: bigint, chars: number): string {
  let rest = value;
  let out = '';
  for (let i = 0; i < chars; i++) {
    out = ALPHABET[Number(rest & 31n)] + out;
    rest >>= 5n;
  }
  return out;
}

export function ulid(nowMs: number, randomBytes: Uint8Array): string {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs > MAX_TIME_MS) {
    throw new RangeError(`ulid time must be an integer in [0, 2^48-1], got ${nowMs}`);
  }
  if (randomBytes.length !== RANDOM_BYTES) {
    throw new RangeError(`ulid needs exactly ${RANDOM_BYTES} random bytes, got ${randomBytes.length}`);
  }
  let random = 0n;
  for (const byte of randomBytes) random = (random << 8n) | BigInt(byte);
  return encode(BigInt(nowMs), 10) + encode(random, 16);
}

export function newId(prefix: IdPrefix, nowMs: number, randomBytes: Uint8Array): string {
  if (!ID_PREFIXES.includes(prefix)) {
    throw new RangeError(`unknown id prefix ${String(prefix)}`);
  }
  return prefix + ulid(nowMs, randomBytes);
}
