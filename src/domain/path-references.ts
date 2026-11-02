// Path references named in map documents (plan 01-10). STUB for the RED commit; implemented in the GREEN commit.
export function extractPathReferences(_markdown: string): string[] {
  return [];
}

export interface DanglingResult {
  total: number;
  dangling: string[];
  share: number;
}

export function danglingShare(_refs: readonly string[], _knownPaths: Iterable<string>): DanglingResult {
  return { total: 0, dangling: [], share: 0 };
}
