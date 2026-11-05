// Test inventory markers and comparison (AUT-9; docs/contracts-and-state.md "Protecting tests and acceptance
// criteria"). Pure: the inventory is measured by AVARICE after an invocation has ended, from the runner's list
// mode and from the test files' text, never from what the model said about its tests.

export interface MarkerSpec {
  marker: string;
  pattern: RegExp;
}

// Skip and focus markers across the JS test runners and the two Python ones. The scan is conservative: a marker
// inside a line comment still counts, because a false positive fails G2 into a decision and never passes it.
export const SKIP_FOCUS_MARKERS: readonly MarkerSpec[] = [
  { marker: '.skip(', pattern: /\.skip\s*[(.]/ },
  { marker: '.only(', pattern: /\.only\s*[(.]/ },
  { marker: 'xit(', pattern: /(?<![\w$.])xit\s*\(/ },
  { marker: 'xdescribe(', pattern: /(?<![\w$.])xdescribe\s*\(/ },
  { marker: 'xtest(', pattern: /(?<![\w$.])xtest\s*\(/ },
  { marker: 'it.todo(', pattern: /(?<![\w$.])it\.todo\s*\(/ },
  { marker: 'test.todo(', pattern: /(?<![\w$.])test\.todo\s*\(/ },
  { marker: 'describe.todo(', pattern: /(?<![\w$.])describe\.todo\s*\(/ },
  { marker: '{ skip: true }', pattern: /\{[^}]*(?<![\w$])skip\s*:\s*true(?![\w$])/ },
  { marker: '{ only: true }', pattern: /\{[^}]*(?<![\w$])only\s*:\s*true(?![\w$])/ },
  { marker: '@pytest.mark.skip', pattern: /@pytest\.mark\.skip/ },
  { marker: '@unittest.skip', pattern: /@unittest\.skip/ },
];

export interface MarkerHit {
  path: string;
  // 1-based.
  line: number;
  marker: string;
}

export function scanMarkers(path: string, text: string): MarkerHit[] {
  const hits: MarkerHit[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    for (const spec of SKIP_FOCUS_MARKERS) {
      if (spec.pattern.test(line)) hits.push({ path, line: i + 1, marker: spec.marker });
    }
  }
  return hits;
}

export interface InventorySnapshot {
  // Test IDs from the runner's list mode.
  ids: readonly string[];
  // Skip and focus marker count per test file path.
  markers: Readonly<Record<string, number>>;
  // Number of test files.
  fileCount: number;
}

export type InventoryFailureRule = 'removed-test' | 'new-skip-marker' | 'lowered-test-count';

export interface InventoryFailure {
  rule: InventoryFailureRule;
  detail: string;
}

// Failures come in the order removed-test, new-skip-marker, lowered-test-count, each listing its subjects sorted,
// so the same snapshots give the same failures whatever order their lists arrive in.
export function compareInventories(base: InventorySnapshot, after: InventorySnapshot): InventoryFailure[] {
  const failures: InventoryFailure[] = [];
  const present = new Set(after.ids);
  const removed = [...new Set(base.ids)].filter((id) => !present.has(id)).sort();
  if (removed.length > 0) {
    failures.push({ rule: 'removed-test', detail: `test IDs present at base and missing after: ${removed.slice(0, 20).join('; ')}${removed.length > 20 ? ` (and ${removed.length - 20} more)` : ''}` });
  }
  const grown = Object.keys(after.markers)
    .sort()
    .filter((path) => (after.markers[path] as number) > (base.markers[path] ?? 0));
  if (grown.length > 0) {
    failures.push({ rule: 'new-skip-marker', detail: `skip or focus markers added in: ${grown.join(', ')}` });
  }
  if (after.fileCount < base.fileCount) {
    failures.push({ rule: 'lowered-test-count', detail: `test files fell from ${base.fileCount} to ${after.fileCount}` });
  }
  return failures;
}
