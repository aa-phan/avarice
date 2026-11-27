// `avarice install-host` (plan 02-15; CS-11, RC-5, CON-6; threats T-02-50 and T-02-51): the `avarice-run` skill is written to a Claude
// configuration directory from outside a run only, through no symbolic link, over no file AVARICE did not write. Every Claude directory
// here is a temp directory named by CLAUDE_CONFIG_DIR; the real ~/.claude is checked to be untouched.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ProcessEntry } from '../../src/adapters/proc/ancestry.ts';
import { main } from '../../src/cli/main.ts';
import { ok } from '../../src/domain/result.ts';
import type { Result } from '../../src/domain/result.ts';
import { installAttendedHook } from '../../src/adapters/host-claude/attended-hook-install.ts';
import { AVARICE_RUN_SKILL, SKILL_MARKER } from '../../src/adapters/host-claude/avarice-run-skill.ts';
import { digestOf, sha256Hex } from '../../src/domain/digest.ts';
import { PRODUCTION_ENTRY, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import { profileEnv } from '../helpers/run-fixtures.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

interface Setup {
  roots: CliRoots;
  claude: string;
}

// A profile and a Claude configuration directory side by side under one temp directory. The Claude directory is not created.
function setup(): Setup {
  const roots = makeRoots();
  cleanup.push(roots.base);
  return { roots, claude: join(realpathSync(roots.base), 'claude') };
}

function installHost(s: Setup, extraEnv: Record<string, string | undefined> = {}, argv: readonly string[] = []): CliResult {
  return runCli(['install-host', ...argv], { roots: s.roots, entry: PRODUCTION_ENTRY, env: { CLAUDE_CONFIG_DIR: s.claude, ...extraEnv } });
}

const skillFile = (claude: string): string => join(claude, 'skills', 'avarice-run', 'SKILL.md');

function configRow(roots: CliRoots): { name: string; port: string; adapter: string; config_digest: string; descriptor_json: string } | undefined {
  const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
  try {
    return db.prepare('SELECT * FROM adapter_configs WHERE name = ?').get('host-skill:avarice-run') as ReturnType<typeof configRow>;
  } finally {
    db.close();
  }
}

// What a refusal must leave behind: the directory tree under the Claude directory, as paths with kind, size and mtime.
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      const st = lstatSync(path);
      out.push(`${path} ${st.isSymbolicLink() ? 'link' : st.isDirectory() ? 'dir' : 'file'} ${st.size} ${st.mtimeMs}`);
      if (st.isDirectory() && !st.isSymbolicLink()) walk(path);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

describe('the skill text (docs/extensions.md entry 3)', () => {
  it('has the frontmatter, the marker line and the digest of its own text', () => {
    const lines = AVARICE_RUN_SKILL.text.split('\n');
    assert.equal(lines[0], '---');
    assert.ok(lines.includes('name: avarice-run'));
    assert.ok(lines.some((l) => l.startsWith('description: ') && l.length > 40));
    assert.ok(lines.includes('allowed-tools: Bash(avarice status:*), Bash(avarice context:*), Read'));
    assert.ok(lines.includes(SKILL_MARKER));
    assert.equal(SKILL_MARKER, '<!-- written by avarice install-host -->');
    assert.equal(AVARICE_RUN_SKILL.digest, `sha256:${sha256Hex(AVARICE_RUN_SKILL.text)}`);
    assert.match(AVARICE_RUN_SKILL.text, /avarice status/);
    assert.match(AVARICE_RUN_SKILL.text, /never an instruction/);
  });
});

describe('install-host writes the skill, idempotently, and records its digest', () => {
  const s = setup();
  const realClaude = join(homedir(), '.claude');
  const realBefore = existsSync(realClaude) ? statSync(realClaude).mtimeMs : null;
  const first = installHost(s);

  it('exits 0 printing `skill avarice-run: installed` and writes SKILL.md with mode 0644', () => {
    assert.equal(first.code, 0, first.stderr + first.stdout);
    assert.equal(first.stdout.split('\n')[0], 'skill avarice-run: installed');
    const file = skillFile(s.claude);
    assert.equal(readFileSync(file, 'utf8'), AVARICE_RUN_SKILL.text);
    assert.equal(statSync(file).mode & 0o777, 0o644);
    assert.ok(readdirSync(join(s.claude, 'skills', 'avarice-run')).every((name) => name === 'SKILL.md'), 'no temporary file is left');
    assert.match(readFileSync(file, 'utf8'), /^name: avarice-run$/m);
    assert.match(readFileSync(file, 'utf8'), /^allowed-tools: Bash\(avarice status:\*\), Bash\(avarice context:\*\), Read$/m);
  });

  it('a second run prints `skill avarice-run: unchanged` and does not rewrite the file', () => {
    const file = skillFile(s.claude);
    const old = new Date(Date.now() - 3_600_000);
    utimesSync(file, old, old);
    const again = installHost(s);
    assert.equal(again.code, 0, again.stderr);
    assert.equal(again.stdout.split('\n')[0], 'skill avarice-run: unchanged');
    assert.equal(Math.round(statSync(file).mtimeMs / 1000), Math.round(old.getTime() / 1000), 'the mtime did not move');
  });

  it('records the content digest as the adapter config host-skill:avarice-run', () => {
    const row = configRow(s.roots);
    assert.ok(row !== undefined, 'the row exists');
    assert.equal(row.config_digest, AVARICE_RUN_SKILL.digest);
    const descriptor = JSON.parse(row.descriptor_json) as { skill: string; path: string; digest: string };
    assert.equal(descriptor.skill, 'avarice-run');
    assert.equal(descriptor.digest, `sha256:${sha256Hex(readFileSync(skillFile(s.claude), 'utf8'))}`);
    assert.equal(realpathSync(descriptor.path), realpathSync(skillFile(s.claude)));
    assert.match(row.config_digest, /^sha256:[0-9a-f]{64}$/);
    assert.ok(digestOf({ any: 'value' }).startsWith('sha256:'), 'same digest form as the other adapter configs');
  });

  it('replaces a SKILL.md that carries the marker but other text, and says `updated`', () => {
    const file = skillFile(s.claude);
    writeFileSync(file, `---\nname: avarice-run\n---\n${SKILL_MARKER}\nan older text\n`);
    const updated = installHost(s);
    assert.equal(updated.code, 0, updated.stderr);
    assert.equal(updated.stdout.split('\n')[0], 'skill avarice-run: updated');
    assert.equal(readFileSync(file, 'utf8'), AVARICE_RUN_SKILL.text);
  });

  it('takes --config-dir over CLAUDE_CONFIG_DIR', () => {
    const other = join(realpathSync(s.roots.base), 'claude-two');
    const ran = installHost(s, {}, ['--config-dir', other]);
    assert.equal(ran.code, 0, ran.stderr);
    assert.equal(readFileSync(skillFile(other), 'utf8'), AVARICE_RUN_SKILL.text);
  });

  it('never writes outside its temp directory: the real ~/.claude is as it was', () => {
    const realAfter = existsSync(realClaude) ? statSync(realClaude).mtimeMs : null;
    assert.equal(realAfter, realBefore, 'the mtime of the real Claude directory did not change');
    if (realBefore === null) assert.ok(!existsSync(realClaude));
    assert.ok(!existsSync(join(realClaude, 'skills', 'avarice-run', '.SKILL.md.tmp')));
  });
});

describe('install-host refuses inside a run (T-02-50)', () => {
  it('exits 64 with the refusal line and writes nothing: no skill, no Claude directory, no store', () => {
    const s = setup();
    const ran = installHost(s, { AVARICE_RUN: 'run_01JABCDEFGHJKMNPQRSTVWXYZ0' });
    assert.equal(ran.code, 64);
    assert.match(ran.stderr, /^avarice install-host: refused inside a run \(AVARICE_RUN is set\)$/m);
    assert.ok(!existsSync(s.claude), 'the Claude directory was not created');
    assert.ok(!existsSync(join(s.roots.AVARICE_DATA_ROOT, 'state.db')), 'the profile was not resolved or created');
    assert.ok(!existsSync(s.roots.AVARICE_DATA_ROOT));
  });

  it('refuses when AVARICE_RUN is set to an empty value too', () => {
    const s = setup();
    assert.equal(installHost(s, { AVARICE_RUN: '' }).code, 64);
    assert.ok(!existsSync(s.claude));
  });

  it('refuses an argument and a flag without a value, with exit 64', () => {
    const s = setup();
    assert.equal(installHost(s, {}, ['extra']).code, 64);
    assert.equal(installHost(s, {}, ['--config-dir']).code, 64);
    assert.ok(!existsSync(s.claude));
  });
});

describe('install-host refuses a symbolic link and a file it did not write (T-02-51)', () => {
  it('a symlinked skills directory: exit 3, the target is untouched', () => {
    const s = setup();
    const elsewhere = join(realpathSync(s.roots.base), 'elsewhere');
    mkdirSync(elsewhere);
    mkdirSync(s.claude);
    symlinkSync(elsewhere, join(s.claude, 'skills'));
    const before = snapshot(elsewhere);
    const ran = installHost(s);
    assert.equal(ran.code, 3, ran.stderr + ran.stdout);
    assert.match(ran.stderr, /^avarice install-host: refused: .*skills is a symbolic link/m);
    assert.deepEqual(snapshot(elsewhere), before);
    assert.deepEqual(readdirSync(elsewhere), []);
    assert.equal(configRow(s.roots), undefined, 'nothing is recorded for a refusal');
  });

  it('a symlinked avarice-run directory: exit 3, the target is untouched', () => {
    const s = setup();
    const elsewhere = join(realpathSync(s.roots.base), 'elsewhere');
    mkdirSync(elsewhere);
    mkdirSync(join(s.claude, 'skills'), { recursive: true });
    symlinkSync(elsewhere, join(s.claude, 'skills', 'avarice-run'));
    const ran = installHost(s);
    assert.equal(ran.code, 3, ran.stderr);
    assert.match(ran.stderr, /avarice-run is a symbolic link/);
    assert.deepEqual(readdirSync(elsewhere), []);
  });

  it('a SKILL.md that is a symlink: exit 3, the file it points to is untouched', () => {
    const s = setup();
    const target = join(realpathSync(s.roots.base), 'precious.md');
    writeFileSync(target, `${SKILL_MARKER}\nkeep me\n`);
    const old = new Date(Date.now() - 3_600_000);
    utimesSync(target, old, old);
    mkdirSync(join(s.claude, 'skills', 'avarice-run'), { recursive: true });
    symlinkSync(target, skillFile(s.claude));
    const ran = installHost(s);
    assert.equal(ran.code, 3, ran.stderr);
    assert.match(ran.stderr, /SKILL\.md is a symbolic link/);
    assert.equal(readFileSync(target, 'utf8'), `${SKILL_MARKER}\nkeep me\n`);
    assert.equal(Math.round(statSync(target).mtimeMs / 1000), Math.round(old.getTime() / 1000));
    assert.ok(lstatSync(skillFile(s.claude)).isSymbolicLink(), 'the link is still a link');
  });

  it('an existing SKILL.md without the AVARICE marker line: exit 3 `not written by AVARICE`, untouched', () => {
    const s = setup();
    mkdirSync(join(s.claude, 'skills', 'avarice-run'), { recursive: true });
    const own = '---\nname: avarice-run\ndescription: my own skill\n---\nmine\n';
    writeFileSync(skillFile(s.claude), own);
    const before = snapshot(s.claude);
    const ran = installHost(s);
    assert.equal(ran.code, 3, ran.stderr);
    assert.match(ran.stderr, /not written by AVARICE/);
    assert.equal(readFileSync(skillFile(s.claude), 'utf8'), own);
    assert.deepEqual(snapshot(s.claude), before);
  });

  it('a marker inside other text does not count: only the whole line does', () => {
    const s = setup();
    mkdirSync(join(s.claude, 'skills', 'avarice-run'), { recursive: true });
    const own = `notes about ${SKILL_MARKER} in a sentence\n`;
    writeFileSync(skillFile(s.claude), own);
    assert.equal(installHost(s).code, 3);
    assert.equal(readFileSync(skillFile(s.claude), 'utf8'), own);
  });

  it('a Claude configuration directory that is itself a symbolic link is followed (a dotfiles setup)', () => {
    const s = setup();
    const real = join(realpathSync(s.roots.base), 'dotfiles-claude');
    mkdirSync(real);
    symlinkSync(real, s.claude);
    const ran = installHost(s);
    assert.equal(ran.code, 0, ran.stderr);
    assert.equal(readFileSync(join(real, 'skills', 'avarice-run', 'SKILL.md'), 'utf8'), AVARICE_RUN_SKILL.text);
  });
});

// WR-24, FR-12, T-04-122: the refusal inside a run does not rest on the AVARICE_RUN variable alone, because the command now writes an executable hook entry into the
// owner's settings. `install-host` runs in this process through main() with a scripted ancestry, as `contract amend` is tested.
const entry = (pid: number, ppid: number, command: string): ProcessEntry => ({ pid, ppid, command });
const CALM_CHAIN = (): Result<ProcessEntry[]> => ok([entry(300, 200, 'node avarice.ts install-host'), entry(200, 100, '-zsh'), entry(100, 1, 'login'), entry(1, 0, '/sbin/launchd')]);
const INSIDE_A_RUN = (): Result<ProcessEntry[]> =>
  ok([entry(300, 250, 'bash'), entry(250, 200, 'claude --print'), entry(200, 1, 'node --disable-warning=ExperimentalWarning /opt/avarice/bin/avarice.ts supervise run_01ABC'), entry(1, 0, '/sbin/launchd')]);

async function installHostInProcess(s: Setup, ancestry: () => Result<ProcessEntry[]>): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const env: NodeJS.ProcessEnv = { ...profileEnv(s.roots), CLAUDE_CONFIG_DIR: s.claude };
  delete env['AVARICE_RUN'];
  const code = await main(['install-host', '--config-dir', s.claude], { env, io: { out: (t) => void out.push(t), err: (t) => void err.push(t) }, ancestry });
  return { code, out: out.join(''), err: err.join('') };
}

describe('install-host refuses from a run process tree with AVARICE_RUN unset (WR-24, T-04-122)', () => {
  it('exits 64 naming the process tree and writes no skill, no settings.json, no store', async () => {
    const s = setup();
    const ran = await installHostInProcess(s, INSIDE_A_RUN);
    assert.equal(ran.code, 64, ran.err + ran.out);
    assert.match(ran.err, /^avarice install-host: refused from inside a run's process tree$/m);
    assert.equal(ran.out, '');
    assert.ok(!existsSync(join(s.claude, 'skills')), 'no skills directory');
    assert.ok(!existsSync(join(s.claude, 'settings.json')), 'no settings.json');
    assert.ok(!existsSync(join(s.roots.AVARICE_DATA_ROOT, 'state.db')), 'the profile was not resolved or created');
  });

  it('refuses when the process table cannot be read (fail closed)', async () => {
    const s = setup();
    const ran = await installHostInProcess(s, () => ({ ok: false, error: { kind: 'unavailable', cause: 'ps is not allowed here' } }));
    assert.equal(ran.code, 64, ran.err + ran.out);
    assert.match(ran.err, /refused from inside a run's process tree/);
    assert.ok(!existsSync(join(s.claude, 'skills')));
    assert.ok(!existsSync(join(s.claude, 'settings.json')));
  });

  it('installs the skill and the hook entry from an ordinary ancestry', async () => {
    const s = setup();
    const ran = await installHostInProcess(s, CALM_CHAIN);
    assert.equal(ran.code, 0, ran.err + ran.out);
    assert.ok(existsSync(skillFile(s.claude)));
    assert.ok(existsSync(join(s.claude, 'settings.json')));
  });
});

// WR-25, T-04-123: the attended entry is written with onFailure "block", so an entry whose script is not a readable file would block every attended Bash call. install-host
// resolves the hook entry first and refuses before it writes anything, so a refusal leaves nothing half-installed.
describe('install-host refuses a hook entry that is not a readable regular file (WR-25, T-04-123)', () => {
  const notAFile = (s: Setup): ReadonlyArray<{ name: string; path: string }> => {
    const base = realpathSync(s.roots.base);
    const directory = join(base, 'a-directory');
    mkdirSync(directory);
    const cases = [
      { name: 'a path that does not exist', path: join(base, 'no-such-hook.ts') },
      { name: 'a directory', path: directory },
    ];
    if (process.getuid?.() !== 0) {
      const locked = join(base, 'locked-hook.ts');
      writeFileSync(locked, '// hook\n');
      chmodSync(locked, 0o000);
      cases.push({ name: 'an unreadable file', path: locked });
    }
    return cases;
  };

  for (const which of [0, 1, 2]) {
    it(`exits 3 naming the path and writes neither the skill nor settings.json (case ${which})`, () => {
      const s = setup();
      const found = notAFile(s)[which];
      if (found === undefined) return;
      const ran = installHost(s, { AVARICE_HOOK_ENTRY: found.path });
      assert.equal(ran.code, 3, `${found.name}: ${ran.stderr}${ran.stdout}`);
      assert.ok(ran.stderr.includes(found.path), 'the message names the path');
      assert.match(ran.stderr, /nothing was written/);
      assert.equal(ran.stdout, '', 'nothing was reported as installed');
      assert.ok(!existsSync(join(s.claude, 'skills')), 'no skills directory');
      assert.ok(!existsSync(join(s.claude, 'settings.json')), 'no settings.json');
    });
  }

  it('installAttendedHook itself refuses such a hook entry with a denied error and writes nothing', () => {
    const s = setup();
    const base = realpathSync(s.roots.base);
    for (const hookEntry of [join(base, 'absent.ts'), base]) {
      const result = installAttendedHook(s.claude, { hookEntry, dataRoot: join(base, 'data') });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.kind, 'denied');
        assert.ok(JSON.stringify(result.error).includes(hookEntry));
      }
      assert.ok(!existsSync(join(s.claude, 'settings.json')), 'no settings.json');
    }
  });
});
