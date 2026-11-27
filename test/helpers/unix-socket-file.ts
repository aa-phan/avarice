// A Unix domain socket planted at a path, for the tests that need a file that exists and cannot be read for a reason that is not a permission (WR-17): opening a socket
// file fails with ENXIO (EOPNOTSUPP on macOS), whoever opens it and under whatever mode, so it stands for "an I/O failure" without a fault injector.
//
// A socket path is limited to about 100 bytes, which a temp directory under a test's own tree can exceed, so the socket is bound at a short path in the system temp
// directory and renamed to where it is wanted; the bound socket keeps listening after the rename. `close()` stops it and removes the short directory; the planted file
// is left for the test's own cleanup.
import net from 'node:net';
import { mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface PlantedSocket {
  close(): Promise<void>;
}

export async function plantSocketFile(path: string): Promise<PlantedSocket> {
  const shortDir = mkdtempSync(join(tmpdir(), 'avs-'));
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(join(shortDir, 's'), resolve);
  });
  renameSync(join(shortDir, 's'), path);
  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          rmSync(shortDir, { recursive: true, force: true });
          resolve();
        });
      }),
  };
}
