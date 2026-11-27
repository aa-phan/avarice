// The shared contract suite against the local adapters (plan 04-33; NFR-4): the SandboxedExecutor and the LocalArtifactStore. The same case lists run against the
// fake-remote adapters in test/contract/fake-remote.test.ts; both runners import the cases, so the two sets of adapters meet one contract.
import { after, describe } from 'node:test';
import { existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SandboxedExecutor } from '../../src/adapters/exec/sandboxed-executor.ts';
import { LocalArtifactStore } from '../../src/adapters/fs/artifact-store.ts';
import { directoryStore, runArtifactContract } from './artifact-store.cases.ts';
import { removeAll, runExecutorContract } from './command-executor.cases.ts';

const cleanup: string[] = [];
after(() => removeAll(cleanup));

describe('CommandExecutor contract: SandboxedExecutor', () => {
  runExecutorContract(() => new SandboxedExecutor(), cleanup, { skip: existsSync('/usr/bin/sandbox-exec') ? false : 'the sandbox is macOS-only' });
});

describe('ArtifactStore contract: LocalArtifactStore', () => {
  runArtifactContract(() => {
    const dataRoot = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-contract-local-')));
    cleanup.push(dataRoot);
    return directoryStore(new LocalArtifactStore(dataRoot), dataRoot);
  });
});
