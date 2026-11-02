// Generates a fake gsd-core directory at run time (no committed fixture). Its bin/gsd-tools.cjs prints an
// identity for `runtime-identity --raw`, behaves as `script` says for anything else, and exits 2 otherwise.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface FakeGsdCoreOptions {
  version: string;
  packageName?: string;
  // Extra JavaScript run for any other verb, with `args` bound to the argv after the script path.
  script?: string;
}

// Creates {dir}/bin/gsd-tools.cjs and returns dir.
export function writeFakeGsdCore(dir: string, options: FakeGsdCoreOptions): string {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const identity = JSON.stringify({ packageName: options.packageName ?? '@opengsd/gsd-core', version: options.version });
  const source = [
    '#!/usr/bin/env node',
    "'use strict';",
    'const args = process.argv.slice(2);',
    `if (args[0] === 'runtime-identity') { process.stdout.write(${JSON.stringify(identity)}); process.exit(0); }`,
    options.script ?? '',
    'process.exit(2);',
    '',
  ].join('\n');
  const target = join(bin, 'gsd-tools.cjs');
  writeFileSync(target, source);
  chmodSync(target, 0o755);
  return dir;
}
