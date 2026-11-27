// The secret corpus of the AC-5 redaction suite (plan 04-22; SEC-3, T-04-61): one valid-shaped sample for every pattern kind the redactor knows, plus a
// seeded credential value that matches no pattern. Every value is generated at test time from a fixed seed (a SHA-256 stream), so no real secret is
// committed and no complete secret-shaped literal sits in this file, yet the corpus is the same on every run and every machine.
import { createHash } from 'node:crypto';
import { findSecrets } from '../../src/domain/secret-patterns.ts';
import type { SecretHit } from '../../src/domain/secret-patterns.ts';

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const UPPER_DIGIT = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// `length` characters of `alphabet`, derived from `seed`: the same text for the same seed.
function derive(seed: string, length: number, alphabet: string): string {
  let out = '';
  for (let block = 0; out.length < length; block += 1) {
    for (const byte of createHash('sha256').update(`${seed}:${block}`).digest()) {
      if (out.length < length) out += alphabet[byte % alphabet.length];
    }
  }
  return out;
}

const b64url = (text: string): string => Buffer.from(text, 'utf8').toString('base64url');

export interface CorpusEntry {
  // The findSecrets pattern name this sample is meant to trigger (`gsd-scan` for the GSD pattern).
  kind: string;
  text: string;
}

// The pem lines are built from parts, so this file never holds the header of a private key block as one literal.
const PEM_HEAD = ['-----BEGIN RSA PRIVATE', ' KEY-----'].join('');
const PEM_TAIL = ['-----END RSA PRIVATE', ' KEY-----'].join('');

export const SECRET_CORPUS: readonly CorpusEntry[] = [
  { kind: 'github-token', text: `ghp_${derive('github', 36, ALNUM)}` },
  { kind: 'aws-key', text: `AKIA${derive('aws', 16, UPPER_DIGIT)}` },
  { kind: 'jwt', text: `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(`{"sub":"${derive('jwt-sub', 12, ALNUM)}"}`)}.${derive('jwt-sig', 43, BASE64URL)}` },
  { kind: 'private-key', text: [PEM_HEAD, derive('pem-1', 64, BASE64), derive('pem-2', 64, BASE64), PEM_TAIL].join('\n') },
  { kind: 'authorization', text: `Authorization: Bearer ${derive('authorization', 32, ALNUM)}` },
  { kind: 'url-userinfo', text: `https://deploy:${derive('userinfo', 20, ALNUM)}@git.example.com/org/repo.git` },
  { kind: 'gsd-scan', text: `sk-${derive('sk', 32, ALNUM)}` },
];

// The credential value a keychain item holds and the redactor is seeded with. It matches no pattern, so only the seeded literal can redact it.
export const SEEDED_VALUE: string = derive('seeded-credential', 28, ALNUM);

export interface CorpusScan {
  // findSecrets hits in the text (pattern name and line, never the matched text).
  patterns: SecretHit[];
  // How many times the seeded value occurs in the text.
  seeded: number;
  // How many times a corpus sample occurs verbatim in the text (a pattern the regexes miss would still be counted here).
  literals: number;
}

function occurrences(text: string, needle: string): number {
  if (needle === '') return 0;
  let count = 0;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) count += 1;
  return count;
}

// What a store, an artifact or a log must not hold: findSecrets hits, the seeded value, and any corpus sample verbatim. `seeded` is the seeded value
// to look for (SEEDED_VALUE unless a test seeds another).
export function scanForCorpus(text: string, seeded: string = SEEDED_VALUE): CorpusScan {
  return {
    patterns: findSecrets(text),
    seeded: occurrences(text, seeded),
    literals: SECRET_CORPUS.reduce((n, entry) => n + occurrences(text, entry.text), 0),
  };
}

export const scanTotal = (scan: CorpusScan): number => scan.patterns.length + scan.seeded + scan.literals;
