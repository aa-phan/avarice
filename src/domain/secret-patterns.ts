// Secret patterns (plan 01-10, T-01-21). Two sources, both applied to every map document:
//   - GSD's own `scan_for_secrets` pattern from workflows/map-codebase.md (GSD 1.17.0), reused verbatim so
//     AVARICE never accepts a document GSD itself would refuse to commit;
//   - AVARICE's redactor patterns (docs/operations-and-testing.md "Observability", Redaction row): GitHub
//     `gh[pousr]_` tokens, JWT shape, AWS key IDs, private key blocks, `Authorization` headers, URL userinfo.
// A finding is a pattern name and a line number, never the matched text; redaction replaces a match with
// `[REDACTED:<kind>]`. Pure: no I/O, no clock.

// grep -E pattern of map-codebase.md `scan_for_secrets`, character for character.
export const GSD_SECRET_REGEX: RegExp = /(sk-[a-zA-Z0-9]{20,}|sk_live_[a-zA-Z0-9]+|sk_test_[a-zA-Z0-9]+|ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|glpat-[a-zA-Z0-9_-]+|AKIA[A-Z0-9]{16}|xox[baprs]-[a-zA-Z0-9-]+|-----BEGIN.*PRIVATE KEY|eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.)/;

const GSD_KIND = 'gsd-scan';

export const AVARICE_SECRET_PATTERNS: ReadonlyArray<{ kind: string; pattern: RegExp }> = [
  { kind: 'github-token', pattern: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { kind: 'jwt', pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { kind: 'aws-key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { kind: 'private-key', pattern: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
  // A scheme and a token-sized value; `Authorization: Bearer ${token}` and prose are not credentials.
  { kind: 'authorization', pattern: /Authorization:[ \t]*(?:Bearer|Basic|Token)[ \t]+[A-Za-z0-9._~+/=-]{16,}/i },
  { kind: 'url-userinfo', pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i },
];

const PEM_BLOCK = /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/g;

export interface SecretHit {
  // The pattern kind, for example `github-token` or `gsd-scan`.
  pattern: string;
  // 1-based line number.
  line: number;
}

// Pattern names and line numbers only (the matched text is never returned).
export function findSecrets(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  const lines = text.split(/\r\n|\n|\r/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (GSD_SECRET_REGEX.test(line)) hits.push({ pattern: GSD_KIND, line: index + 1 });
    for (const { kind, pattern } of AVARICE_SECRET_PATTERNS) {
      if (pattern.test(line)) hits.push({ pattern: kind, line: index + 1 });
    }
  }
  return hits;
}

function globalOf(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
}

// Replaces every match with `[REDACTED:<kind>]`. A private key block goes whole, body included; the GSD pattern
// runs last so it only names what the AVARICE patterns did not already classify.
export function redactSecrets(text: string): string {
  let out = text.replace(PEM_BLOCK, '[REDACTED:private-key]');
  for (const { kind, pattern } of AVARICE_SECRET_PATTERNS) {
    out = out.replace(globalOf(pattern), `[REDACTED:${kind}]`);
  }
  return out.replace(globalOf(GSD_SECRET_REGEX), `[REDACTED:${GSD_KIND}]`);
}
