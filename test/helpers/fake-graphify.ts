// A fake `graphify` executable for the index-stage tests: it answers `--version`, `extract` and `cluster-only`
// the way graphify 0.9.x does for a code-only run (graph.json under {out}/graphify-out with built_at_commit set
// to the HEAD of the tree it was given, then GRAPH_REPORT.md), with configurable misbehaviour. It is a script in
// a temp directory; nothing here imports it into src/ or bin/.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type FakeGraphifyMode =
  | 'ok'
  // `extract` exits 3 with a message on stderr.
  | 'extract-fails'
  // `extract` never returns, so the executor's timeout ends it.
  | 'hang'
  // graph.json is not JSON.
  | 'invalid-json'
  // graph.json holds two document nodes.
  | 'documents'
  // built_at_commit is a different, well-formed commit.
  | 'wrong-commit'
  // graph.json has no built_at_commit.
  | 'no-commit'
  // `cluster-only` finishes without writing GRAPH_REPORT.md.
  | 'no-report';

export const FAKE_GRAPH_NODES = { code: 2, concept: 1, document: 0 };
export const FAKE_GRAPH_EDGES = { EXTRACTED: 1 };

// Creates {dir}/graphify and returns its path (use it as AVARICE_GRAPHIFY_BIN).
export function writeFakeGraphify(dir: string, mode: FakeGraphifyMode = 'ok', version = '0.9.53'): string {
  mkdirSync(dir, { recursive: true });
  const source = `#!${process.execPath}
'use strict';
const { execFileSync } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const mode = ${JSON.stringify(mode)};
const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write('graphify ${version}\\n');
  process.exit(0);
}
if (args[0] === 'extract') {
  const staging = args[1];
  const out = args[args.indexOf('--out') + 1];
  if (mode === 'extract-fails') {
    process.stderr.write('graphify: cannot parse the tree\\n');
    process.exit(3);
  }
  if (mode === 'hang') setInterval(() => {}, 1000);
  else {
    const head = execFileSync('/usr/bin/git', ['-C', staging, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const nodes = [
      { id: 'a', label: 'a', file_type: 'code', source_file: 'src/index.ts' },
      { id: 'b', label: 'b', file_type: 'code', source_file: 'src/util/strings.ts' },
      { id: 'c', label: 'Config', file_type: 'concept' },
    ];
    if (mode === 'documents') nodes.push({ id: 'd1', label: 'guide', file_type: 'document', source_file: 'docs/guide.md' }, { id: 'd2', label: 'readme', file_type: 'document', source_file: 'README.md' });
    const graph = { directed: false, multigraph: false, nodes, links: [{ source: 'a', target: 'b', relation: 'imports', confidence: 'EXTRACTED', confidence_score: 1 }] };
    if (mode === 'wrong-commit') graph.built_at_commit = 'f'.repeat(40);
    else if (mode !== 'no-commit') graph.built_at_commit = head;
    mkdirSync(join(out, 'graphify-out'), { recursive: true });
    writeFileSync(join(out, 'graphify-out', 'graph.json'), mode === 'invalid-json' ? 'this is not json' : JSON.stringify(graph));
    process.exit(0);
  }
} else if (args[0] === 'cluster-only') {
  if (mode !== 'no-report') writeFileSync(join(args[1], 'graphify-out', 'GRAPH_REPORT.md'), '# Graph report\\n\\nNo communities were labeled.\\n');
  process.exit(0);
} else {
  process.stderr.write('graphify: unknown command ' + args[0] + '\\n');
  process.exit(2);
}
`;
  const target = join(dir, 'graphify');
  writeFileSync(target, source);
  chmodSync(target, 0o755);
  return target;
}
