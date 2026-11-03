// Fixtures for the index steps and the context command (plan 01-17).
//
// The five intel documents are written the way gsd-intel-updater writes them, and are accepted by the real
// `gsd_run intel validate` (iterated against the real verb, see intel-step.test.ts). They describe the scratch
// repository the integration tests onboard (src/index.ts exporting `answer` and `helper`, src/util/strings.ts
// exporting `upper`).
import { createHash } from 'node:crypto';

export const INTEL_FILE_NAMES = ['file-roles.json', 'api-map.json', 'dependency-graph.json', 'arch-decisions.json', 'stack.json'] as const;
export type IntelFileName = (typeof INTEL_FILE_NAMES)[number];

// A fixed time well inside GSD's 24 hour freshness window for any run that reads it at once; GSD only warns about
// age, and the tests never depend on the warning.
export function intelDocuments(updatedAt: string = new Date().toISOString()): Record<IntelFileName, unknown> {
  const meta = { updated_at: updatedAt, version: 1 };
  return {
    'file-roles.json': {
      _meta: meta,
      entries: {
        'src/index.ts': { exports: ['answer', 'helper'], imports: ['./util/strings'], type: 'entry-point' },
        'src/util/strings.ts': { exports: ['upper'], imports: [], type: 'module' },
        'package.json': { exports: [], imports: [], type: 'config' },
      },
    },
    'api-map.json': { _meta: meta, entries: {} },
    'dependency-graph.json': {
      _meta: meta,
      entries: {
        typescript: { version: '^5.0.0', type: 'development', used_by: ['npm run build'], invocation: 'npm run build' },
      },
    },
    'arch-decisions.json': {
      _meta: meta,
      entries: {
        overview: { pattern: 'flat module layout', description: 'answer in src/index.ts calls helper; strings utilities live under src/util' },
        'component:Strings': { path: 'src/util/strings.ts', responsibility: 'string helpers such as upper' },
      },
    },
    'stack.json': {
      _meta: meta,
      languages: ['TypeScript'],
      frameworks: [],
      tools: [],
      build_system: 'npm scripts',
      test_framework: 'node:test',
      package_manager: 'npm',
    },
  };
}

export function serializeIntel(documents: Record<IntelFileName, unknown>): Record<IntelFileName, string> {
  const out = {} as Record<IntelFileName, string>;
  for (const name of INTEL_FILE_NAMES) out[name] = `${JSON.stringify(documents[name], null, 2)}\n`;
  return out;
}

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

// What `gsd_run intel snapshot` writes: the hash of each file's bytes, a timestamp and a version.
export function refreshSnapshot(files: Partial<Record<IntelFileName, string>>, timestamp = '2026-01-01T00:00:00.000Z'): string {
  const hashes: Record<string, string> = {};
  for (const name of INTEL_FILE_NAMES) {
    const content = files[name];
    if (content !== undefined) hashes[name] = sha256(content);
  }
  return `${JSON.stringify({ hashes, timestamp, version: 1 }, null, 2)}\n`;
}
