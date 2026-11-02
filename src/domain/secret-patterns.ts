// Secret patterns (plan 01-10, T-01-21). STUB for the RED commit; implemented in the GREEN commit.
export const GSD_SECRET_REGEX: RegExp = /(?!)/;
export const AVARICE_SECRET_PATTERNS: ReadonlyArray<{ kind: string; pattern: RegExp }> = [];

export interface SecretHit {
  pattern: string;
  line: number;
}

export function findSecrets(_text: string): SecretHit[] {
  return [];
}

export function redactSecrets(text: string): string {
  return text;
}
