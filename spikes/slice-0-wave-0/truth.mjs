#!/usr/bin/env node
// Ground-truth probes for the Wave 0 spikes. Every verdict is computed from files, git state or tool output, never from
// what the model reported. Subcommands print JSON on stdout.
//   snapshot REPO                      refs digest, HEAD, config bytes, per-worktree HEAD
//   diff BEFORE.json AFTER.json        which parts of a snapshot changed
//   files DIR NAME...                  existence and size of files in DIR
//   tree DIR [MAXDEPTH]                relative file list (counts only beyond 60 entries)
//   results RUN.jsonl NEEDLE...        occurrences of each needle inside tool_result texts, and inside the whole transcript
//   hooklog HOOK.log NEEDLE...         occurrences of each needle in hook-logged Bash commands
//   graph GRAPH.json                   node and edge counts by type, origin and confidence
//   status REPO                        git status --porcelain lines (untracked files included)
//   mtime FILE...                      modification times
//   combine KEY=FILE...                merge JSON files into one object
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const [cmd, ...a] = process.argv.slice(2);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const safeEnv = {
  ...process.env, GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/dev/null',
  GIT_CONFIG_KEY_1: 'core.fsmonitor', GIT_CONFIG_VALUE_1: 'false', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0',
};
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { env: safeEnv, encoding: 'utf8' });
const out = (o) => process.stdout.write(JSON.stringify(o, null, 2) + '\n');

if (cmd === 'snapshot') {
  const repo = a[0];
  const gitdir = path.join(repo, '.git');
  const refs = git(repo, 'for-each-ref', '--format=%(refname) %(objectname)').trim();
  const cfg = fs.readFileSync(path.join(gitdir, 'config'));
  const wtDir = path.join(gitdir, 'worktrees');
  const worktreeHeads = {};
  if (fs.existsSync(wtDir)) for (const n of fs.readdirSync(wtDir)) worktreeHeads[n] = fs.readFileSync(path.join(wtDir, n, 'HEAD'), 'utf8').trim();
  out({
    repo, refs: refs.split('\n').filter(Boolean), refsSha: sha(refs), head: fs.readFileSync(path.join(gitdir, 'HEAD'), 'utf8').trim(),
    configSha: sha(cfg), configBytes: cfg.length, configTail: cfg.toString('utf8').split('\n').slice(-3).join(' | '), worktreeHeads,
    objectCount: Number(git(repo, 'count-objects').split(' ')[0]),
  });
} else if (cmd === 'diff') {
  const b = JSON.parse(fs.readFileSync(a[0], 'utf8')); const f = JSON.parse(fs.readFileSync(a[1], 'utf8'));
  out({
    refsChanged: b.refsSha !== f.refsSha, headChanged: b.head !== f.head, configChanged: b.configSha !== f.configSha,
    worktreeHeadChanged: JSON.stringify(b.worktreeHeads) !== JSON.stringify(f.worktreeHeads), objectsAdded: f.objectCount - b.objectCount,
    refsBefore: b.refs, refsAfter: f.refs, configTailAfter: f.configTail,
  });
} else if (cmd === 'files') {
  const [dir, ...names] = a; const r = {};
  for (const n of names) {
    const p = path.join(dir, n);
    r[n] = fs.existsSync(p) ? { exists: true, bytes: fs.statSync(p).size, lines: fs.readFileSync(p, 'utf8').split('\n').length } : { exists: false };
  }
  out({ dir, present: Object.keys(r).filter((k) => r[k].exists), missing: Object.keys(r).filter((k) => !r[k].exists), files: r });
} else if (cmd === 'tree') {
  const [dir, depth = '4'] = a; const found = [];
  const walk = (d, n) => { if (n > Number(depth) || !fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'cache') walk(p, n + 1); } else found.push(path.relative(dir, p)); } };
  walk(dir, 0);
  out({ dir, count: found.length, files: found.slice(0, 60) });
} else if (cmd === 'results') {
  const [file, ...needles] = a;
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const texts = [];
  for (const l of raw.split('\n').filter(Boolean)) {
    let e; try { e = JSON.parse(l); } catch { continue; }
    for (const b of (Array.isArray(e.message?.content) ? e.message.content : [])) {
      if (b.type === 'tool_result') texts.push(Array.isArray(b.content) ? b.content.map((x) => x.text ?? '').join('\n') : String(b.content ?? ''));
    }
  }
  const joined = texts.join('\n');
  const r = {};
  for (const n of needles) r[n] = { inToolResults: joined.split(n).length - 1, inTranscript: raw.split(n).length - 1 };
  out({ file, toolResultCount: texts.length, needles: r });
} else if (cmd === 'hooklog') {
  const [file, ...needles] = a;
  const cmds = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return String(JSON.parse(l).input?.tool_input?.command ?? ''); } catch { return ''; } }) : [];
  const r = {}; for (const n of needles) r[n] = cmds.filter((c) => c.includes(n)).length;
  out({ file, bashCommands: cmds.filter(Boolean).length, needles: r });
} else if (cmd === 'graph') {
  const g = JSON.parse(fs.readFileSync(a[0], 'utf8'));
  const count = (arr, f) => arr.reduce((m, x) => { const k = f(x) ?? 'none'; m[k] = (m[k] ?? 0) + 1; return m; }, {});
  const edges = g.links ?? g.edges ?? [];
  const docIds = new Set(g.nodes.filter((n) => n.file_type === 'document').map((n) => n.id));
  out({
    nodes: g.nodes.length, edges: edges.length, builtAtCommit: g.built_at_commit ?? null,
    nodesByFileType: count(g.nodes, (n) => n.file_type), nodesByOrigin: count(g.nodes, (n) => n._origin),
    edgesByConfidence: count(edges, (e) => e.confidence),
    documentEdgesExtracted: edges.filter((e) => e.confidence === 'EXTRACTED' && (docIds.has(e.source) || docIds.has(e.target))).length,
    sourceFiles: [...new Set(g.nodes.map((n) => n.source_file).filter(Boolean))].slice(0, 30),
  });
} else if (cmd === 'status') {
  out({ repo: a[0], lines: git(a[0], 'status', '--porcelain=v1', '--untracked-files=all').split('\n').filter(Boolean) });
} else if (cmd === 'mtime') {
  out(Object.fromEntries(a.map((f) => [f, fs.existsSync(f) ? fs.statSync(f).mtimeMs : null])));
} else if (cmd === 'combine') {
  const r = {};
  for (const kv of a) { const i = kv.indexOf('='); r[kv.slice(0, i)] = JSON.parse(fs.readFileSync(kv.slice(i + 1), 'utf8')); }
  out(r);
} else {
  console.error('truth.mjs: unknown subcommand'); process.exit(2);
}
