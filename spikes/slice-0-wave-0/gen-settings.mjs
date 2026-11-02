#!/usr/bin/env node
// Wave 0 spike helper, three modes:
//   gen-settings.mjs CASE.json OUT.json              render host settings (OUT.json) and run metadata (OUT.meta.json)
//   gen-settings.mjs --agents OUT.json AGENT.md...    convert GSD agent definitions to the --agents JSON shape
//   gen-settings.mjs --preamble WORKFLOW.md OUT.txt   extract the GSD shim preamble (first bash line of init_context)
// The settings shape follows docs/containment.md "Generated host settings".
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);

function fail(msg) { console.error(`gen-settings: ${msg}`); process.exit(2); }

if (args[0] === '--agents') {
  const [, out, ...files] = args;
  if (!out || files.length === 0) fail('usage: --agents OUT.json AGENT.md...');
  const agents = {};
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) fail(`no frontmatter in ${f}`);
    const fm = {};
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
      if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
    }
    if (!fm.name) fail(`no name in ${f}`);
    const entry = { description: fm.description ?? fm.name, prompt: m[2].trim() };
    if (fm.tools) entry.tools = fm.tools.split(',').map((s) => s.trim()).filter(Boolean);
    agents[fm.name] = entry;
  }
  fs.writeFileSync(out, JSON.stringify(agents));
  process.exit(0);
}

if (args[0] === '--preamble') {
  const [, workflow, out] = args;
  if (!workflow || !out) fail('usage: --preamble WORKFLOW.md OUT.txt');
  const lines = fs.readFileSync(workflow, 'utf8').split('\n');
  const idx = lines.findIndex((l) => l.startsWith('_GSD_SHIM_NAME='));
  if (idx < 0) fail('no shim preamble line found');
  fs.writeFileSync(out, lines[idx] + '\n');
  process.exit(0);
}

const [caseFile, outFile] = args;
if (!caseFile || !outFile) fail('usage: gen-settings.mjs CASE.json OUT.json');
const root = process.env.SPIKE_ROOT;
if (!root) fail('SPIKE_ROOT is not set');
const subst = (v) => (typeof v === 'string'
  ? v.replaceAll('{ROOT}', root).replaceAll('{HOME}', os.homedir()).replaceAll('{GSD}', process.env.GSD_CORE ?? `${os.homedir()}/.claude/gsd-core`)
      .replaceAll('{SRC}', `${root}/src-repo`).replaceAll('{WT}', `${root}/wt`).replaceAll('{CLONE}', `${root}/clone`)
      .replaceAll('{TARGET}', `${root}/target-clone`).replaceAll('{KP}', `${root}/kp`)
  : Array.isArray(v) ? v.map(subst)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, subst(x)]))
  : v);
const c = subst(JSON.parse(fs.readFileSync(caseFile, 'utf8')));
const name = c.case;
const sbx = (p) => (p.startsWith('/') ? `/${p}` : p);   // '//abs' marks an absolute path
const list = (k) => (c[k] ?? []).map(sbx);
const hookLog = `${root}/out/${name}.hook.log`;
const hookArgs = [path.join(here, 'hook-log.mjs'), hookLog, c.hook ?? 'log'];
if (c.hook === 'allow-preamble') hookArgs.push(`${root}/preamble-line.txt`);

const fsCfg = { allowWrite: list('allowWrite'), denyWrite: list('denyWrite'), denyRead: list('denyRead') };
if ((c.allowRead ?? []).length) fsCfg.allowRead = list('allowRead');
const settings = {
  permissions: { defaultMode: 'dontAsk', disableBypassPermissionsMode: 'disable', allow: c.allow ?? [], deny: c.deny ?? [] },
  sandbox: {
    enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: false,
    excludedCommands: [], filesystem: fsCfg, network: { allowedDomains: [], strictAllowlist: true },
  },
  hooks: { PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: [process.execPath, ...hookArgs].join(' '), timeout: 5, onFailure: 'block' }] }] },
};
fs.writeFileSync(outFile, JSON.stringify(settings, null, 2));
const memoryEnv = c.memoryEnv !== false
  ? { CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' } : {};
const meta = {
  case: name, spike: c.spike, cwd: c.cwd, hook: c.hook ?? 'log', hookLog, pathMode: c.pathMode ?? 'gsd-first',
  extraPath: c.extraPath ?? [], mkdirs: c.mkdirs ?? [], env: { ...memoryEnv, ...(c.env ?? {}) },
  settingsSummary: {
    allow: settings.permissions.allow, deny: settings.permissions.deny, hook: c.hook ?? 'log',
    allowWrite: fsCfg.allowWrite, denyWrite: fsCfg.denyWrite, denyRead: fsCfg.denyRead, allowRead: fsCfg.allowRead ?? [],
  },
};
fs.writeFileSync(outFile.replace(/\.json$/, '.meta.json'), JSON.stringify(meta, null, 2));
