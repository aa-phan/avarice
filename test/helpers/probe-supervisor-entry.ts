// Test-only stand-in for the CLI entry that spawnSupervisor starts: it records what a detached supervisor sees (its working
// directory, whether its standard streams are /dev/null) to the file named by AVARICE_PROBE_OUT, then stays alive for a few
// seconds so a test can read its process group, and exits. Nothing here touches a ledger or a repository.
// `node --test` with no file list also loads every file under test/; under the runner NODE_TEST_CONTEXT is set (runCli and
// spawnSupervisor's callers delete it for real children), so the helper does nothing there.
import { fstatSync, statSync, writeFileSync } from 'node:fs';

if (process.env['NODE_TEST_CONTEXT'] === undefined) {
  const out = process.env['AVARICE_PROBE_OUT'];
  if (out !== undefined) {
    const devNull = statSync('/dev/null').rdev;
    const isNull = (fd: number): boolean => {
      try {
        const stat = fstatSync(fd);
        return stat.isCharacterDevice() && stat.rdev === devNull;
      } catch {
        return false;
      }
    };
    writeFileSync(out, JSON.stringify({ pid: process.pid, cwd: process.cwd(), argv: process.argv.slice(2), stdio: [isNull(0), isNull(1), isNull(2)] }));
  }
  setTimeout(() => undefined, Number(process.env['AVARICE_PROBE_LIVE_MS'] ?? '8000'));
}
