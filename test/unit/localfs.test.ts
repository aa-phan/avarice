// Local-mount check (ADR-003, research assumption A6): the data root must sit on a mount that `mount` reports
// with the `local` flag. The parser is proven on fixture text; one test runs the real command.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isLocalMount, mountFor, parseMountOutput } from '../../src/adapters/fs/local-mount.ts';

const MOUNT_OUTPUT = `/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)
devfs on /dev (devfs, local, nobrowse)
/dev/disk3s5 on /System/Volumes/Data (apfs, local, journaled, nobrowse, protect, root data)
//aphan@fileserver.local/share on /Volumes/share (smbfs, nodev, nosuid, mounted by aphan)
nas.local:/export/home on /Volumes/nfshome (nfs, nodev, nosuid, mounted by aphan)
afp_0TQ7s1FQ0uKaRGDa1000000000000000000000000 on /Volumes/afpvol (afpfs, nodev, nosuid, mounted by aphan)
http://localhost:8080/dav on /Volumes/My Dav (webdav, nodev, nosuid, mounted by aphan)
/dev/disk5s1 on /Volumes/Backup Disk (apfs, local, nodev, nosuid, journaled)
map auto_home on /System/Volumes/Data/home (autofs, automounted, nobrowse)
`;

describe('parseMountOutput', () => {
  const entries = parseMountOutput(MOUNT_OUTPUT);

  it('reads every line, including mount points with spaces', () => {
    assert.equal(entries.length, 9);
    assert.deepEqual(entries.map((e) => e.mountPoint), ['/', '/dev', '/System/Volumes/Data', '/Volumes/share', '/Volumes/nfshome', '/Volumes/afpvol', '/Volumes/My Dav', '/Volumes/Backup Disk', '/System/Volumes/Data/home']);
  });

  it('marks apfs lines with the local flag as local', () => {
    const root = entries.find((e) => e.mountPoint === '/');
    assert.equal(root?.fstype, 'apfs');
    assert.equal(root?.local, true);
    assert.equal(entries.find((e) => e.mountPoint === '/Volumes/Backup Disk')?.local, true);
  });

  it('marks smbfs, nfs, afpfs and webdav lines without the local flag as not local', () => {
    for (const [mountPoint, fstype] of [['/Volumes/share', 'smbfs'], ['/Volumes/nfshome', 'nfs'], ['/Volumes/afpvol', 'afpfs'], ['/Volumes/My Dav', 'webdav']] as const) {
      const entry = entries.find((e) => e.mountPoint === mountPoint);
      assert.equal(entry?.fstype, fstype);
      assert.equal(entry?.local, false, mountPoint);
    }
  });

  it('ignores a blank or unparseable line', () => {
    assert.equal(parseMountOutput('\nnot a mount line\n').length, 0);
  });
});

describe('mountFor', () => {
  const entries = parseMountOutput(MOUNT_OUTPUT);

  it('picks the longest mount-point prefix', () => {
    assert.equal(mountFor(entries, '/Volumes/share/project/data')?.fstype, 'smbfs');
    assert.equal(mountFor(entries, '/Volumes/share')?.fstype, 'smbfs');
    assert.equal(mountFor(entries, '/System/Volumes/Data/Users/a')?.mountPoint, '/System/Volumes/Data');
    assert.equal(mountFor(entries, '/Volumes/My Dav/x')?.fstype, 'webdav');
  });

  it('matches on a path boundary, not a string prefix', () => {
    assert.equal(mountFor(entries, '/Volumes/sharedother/x')?.mountPoint, '/');
    assert.equal(mountFor(entries, '/Users/a/data')?.mountPoint, '/');
  });
});

describe('isLocalMount', () => {
  it('reports the temp directory of this machine as local', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-mount-')));
    try {
      assert.deepEqual(isLocalMount(dir), { ok: true, value: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
