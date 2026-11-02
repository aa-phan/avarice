#!/usr/bin/env node
// Regenerates cases/*.json (the per-case containment settings inputs consumed by gen-settings.mjs).
// Placeholders {SRC} {WT} {CLONE} {TARGET} {KP} {GSD} {HOME} {ROOT} are expanded by gen-settings.mjs.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'cases');
fs.mkdirSync(dir, { recursive: true });

const secretsDeny = ['Read(~/.ssh/**)', 'Read(~/.config/gh/**)', 'Bash(git push:*)', 'Bash(gh:*)', 'Bash(claude:*)', 'WebSearch'];
const denyRead = ['~/.ssh', '~/.aws', '~/.config/gh'];
// Existing top-level entries of the scratch repository, denied for shell writes (containment.md: cwd is always writable).
const topDeny = ['{SRC}/src', '{SRC}/docs', '{SRC}/README.md', '{SRC}/CLAUDE.md', '{SRC}/.env', '{SRC}/.git'];
const narrow = ['Bash(gsd_run:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(head:*)', 'Bash(wc:*)', 'Bash(git ls-files:*)', 'Bash(git log:*)', 'Bash(git rev-parse:*)'];
const mapAllow = ['Read(/{SRC}/**)', 'Read(/{GSD}/**)', 'Edit(/{SRC}/.planning/codebase/**)', 'Glob', 'Grep', 'Agent'];
const mapBase = (name, spike, extra) => ({
  case: name, spike, cwd: '{SRC}', hook: 'log', allow: [...mapAllow], deny: secretsDeny,
  allowWrite: ['{SRC}/.planning/codebase'], denyWrite: topDeny, denyRead, mkdirs: ['{SRC}/.planning/codebase'], ...extra,
});

const cases = [
  // P0: precondition check (login and launch line work under the rebuilt environment)
  { case: 'P0', spike: 'precondition', cwd: '{SRC}', hook: 'log', allow: [], deny: secretsDeny, allowWrite: [], denyWrite: [], denyRead },
  // S0-A: Bash permission semantics for the GSD preamble
  mapBase('A1', 'S0-A', { allow: [...mapAllow, ...narrow] }),
  mapBase('A2', 'S0-A', { allow: [...mapAllow, 'Bash'] }),
  mapBase('A3', 'S0-A', { hook: 'allow-preamble' }),
  mapBase('A4', 'S0-A', { hook: 'allow-preamble', allow: [...mapAllow, ...narrow] }),
  // A5: no Bash allow rule at all, hook only logs; the exact GSD preamble and two plain commands are requested
  mapBase('A5', 'S0-A', { allowWrite: ['{SRC}/.planning/codebase'] }),
  // A6: hook denies every call; shows whether a hook deny holds when sandboxed Bash is otherwise runnable
  mapBase('A6', 'S0-A', { hook: 'deny-all' }),
  // A7: the fast map skill (allowed-tools includes Bash) under a hook that denies every call
  mapBase('A7', 'S0-A', { hook: 'deny-all' }),
  // A8: A5 prompt with the allow-preamble hook: does a hook allow admit a command no rule allows under dontAsk
  mapBase('A8', 'S0-A', { hook: 'allow-preamble' }),
  // S0-B: linked worktree and clone, writes allowed only to .planning/codebase
  {
    case: 'B1', spike: 'S0-B', cwd: '{WT}', hook: 'log',
    allow: ['Read(/{WT}/**)', 'Edit(/{WT}/.planning/codebase/**)', 'Bash'], deny: secretsDeny,
    allowWrite: ['{WT}/.planning/codebase'], denyWrite: [], denyRead, mkdirs: ['{WT}/.planning/codebase'],
  },
  {
    case: 'B2', spike: 'S0-B', cwd: '{WT}', hook: 'log',
    allow: ['Read(/{WT}/**)', 'Edit(/{WT}/.planning/codebase/**)', 'Bash'], deny: secretsDeny,
    allowWrite: ['{WT}/.planning/codebase'], denyWrite: ['{SRC}/.git', '{SRC}/.git/worktrees/wt'], denyRead, mkdirs: ['{WT}/.planning/codebase'],
  },
  {
    case: 'B3', spike: 'S0-B', cwd: '{CLONE}', hook: 'log',
    allow: ['Read(/{CLONE}/**)', 'Edit(/{CLONE}/.planning/codebase/**)', 'Bash'], deny: secretsDeny,
    allowWrite: ['{CLONE}/.planning/codebase'], denyWrite: ['{CLONE}/.git'], denyRead, mkdirs: ['{CLONE}/.planning/codebase'],
  },
  {
    case: 'B4', spike: 'S0-B', cwd: '{WT}', hook: 'log',
    allow: ['Read(/{WT}/**)', 'Edit(/{WT}/.planning/codebase/**)', 'Bash'], deny: [...secretsDeny, 'Read(/{SRC}/**)'],
    allowWrite: ['{WT}/.planning/codebase'], denyWrite: ['{SRC}/.git', '{SRC}/.git/worktrees/wt'],
    denyRead: [...denyRead, '{SRC}'], allowRead: ['{SRC}/.git'], mkdirs: ['{WT}/.planning/codebase'],
  },
  // S0-C: gsd_run discovery with the generated environment
  { case: 'C1', spike: 'S0-C', cwd: '{SRC}', hook: 'log', pathMode: 'gsd-first', allow: ['Read(/{SRC}/**)', 'Bash'], deny: secretsDeny, allowWrite: [], denyWrite: topDeny, denyRead },
  { case: 'C2', spike: 'S0-C', cwd: '{SRC}', hook: 'log', pathMode: 'plain', allow: ['Read(/{SRC}/**)', 'Bash'], deny: secretsDeny, allowWrite: [], denyWrite: topDeny, denyRead },
  // S0-D: intel seam
  {
    case: 'D1', spike: 'S0-D', cwd: '{SRC}', hook: 'log',
    allow: ['Read(/{SRC}/**)', 'Read(/{GSD}/**)', 'Edit(/{SRC}/.planning/intel/**)', 'Glob', 'Grep', 'Bash'], deny: secretsDeny,
    allowWrite: ['{SRC}/.planning/intel'], denyWrite: [...topDeny, '{SRC}/.planning/config.json'], denyRead, mkdirs: ['{SRC}/.planning/intel'],
  },
  {
    case: 'D2', spike: 'S0-D', cwd: '{SRC}', hook: 'log',
    allow: ['Read(/{SRC}/**)', 'Read(/{GSD}/**)', 'Edit(/{SRC}/.planning/intel/**)', 'Glob', 'Grep', 'Agent', 'Bash'], deny: secretsDeny,
    allowWrite: ['{SRC}/.planning/intel'], denyWrite: [...topDeny, '{SRC}/.planning/config.json'], denyRead, mkdirs: ['{SRC}/.planning/intel'],
  },
  // S0-E: instruction and skill loading
  { case: 'E1', spike: 'S0-E', cwd: '{SRC}', hook: 'log', allow: ['Read(/{SRC}/**)'], deny: secretsDeny, allowWrite: [], denyWrite: [], denyRead },
  { case: 'E2', spike: 'S0-E', cwd: '{SRC}', hook: 'log', memoryEnv: false, allow: ['Read(/{SRC}/**)'], deny: secretsDeny, allowWrite: [], denyWrite: [], denyRead },
  { case: 'E1b', spike: 'S0-E', cwd: '{SRC}', hook: 'log', allow: ['Read(/{SRC}/**)'], deny: secretsDeny, allowWrite: [], denyWrite: [], denyRead },
  { case: 'E2b', spike: 'S0-E', cwd: '{SRC}', hook: 'log', memoryEnv: false, allow: ['Read(/{SRC}/**)'], deny: secretsDeny, allowWrite: [], denyWrite: [], denyRead },
  // E4: positive control, the same probe with project settings loaded (the flag is overridden after the harness default)
  { case: 'E4', spike: 'S0-E', cwd: '{SRC}', hook: 'log', memoryEnv: false, allow: ['Read(/{SRC}/**)'], deny: secretsDeny, allowWrite: [], denyWrite: [], denyRead },
  {
    case: 'E3', spike: 'S0-E', cwd: '{SRC}', hook: 'log', allow: ['Read(/{SRC}/**)', 'Read(/{GSD}/**)', 'Glob', 'Grep', 'Bash(gsd_run:*)'], deny: secretsDeny,
    allowWrite: [], denyWrite: topDeny, denyRead,
  },
  // S0-G: knowledge pass, cwd is the only writable directory, network denied
  {
    case: 'G1', spike: 'S0-G', cwd: '{KP}/.avarice-knowledge', hook: 'log',
    allow: ['Read(/{KP}/**)', 'Read(/{GSD}/**)', 'Edit(/{KP}/.avarice-knowledge/**)', 'Glob', 'Grep', 'Agent', 'Bash'], deny: secretsDeny,
    allowWrite: ['{KP}/.avarice-knowledge'], denyWrite: [], denyRead,
  },
  {
    case: 'G2', spike: 'S0-G', cwd: '{KP}/.avarice-knowledge', hook: 'log', extraPath: ['{HOME}/.local/bin'],
    allow: ['Read(/{KP}/**)', 'Read(/{GSD}/**)', 'Edit(/{KP}/.avarice-knowledge/**)', 'Glob', 'Grep', 'Agent', 'Bash'], deny: secretsDeny,
    allowWrite: ['{KP}/.avarice-knowledge'], denyWrite: [], denyRead,
  },
  // G3: G2 plus Read access to the skill reference files (the symlinked plugin directory and its real target)
  {
    case: 'G3', spike: 'S0-G', cwd: '{KP}/.avarice-knowledge', hook: 'log', extraPath: ['{HOME}/.local/bin'],
    allow: ['Read(/{KP}/**)', 'Read(/{GSD}/**)', 'Read(/{ROOT}/plugin/**)', 'Read(/{HOME}/.claude/skills/graphify/**)', 'Edit(/{KP}/.avarice-knowledge/**)', 'Glob', 'Grep', 'Agent', 'Bash'], deny: secretsDeny,
    allowWrite: ['{KP}/.avarice-knowledge'], denyWrite: [], denyRead,
  },
];
for (const c of cases) fs.writeFileSync(path.join(dir, `${c.case}.json`), JSON.stringify(c, null, 2) + '\n');
console.log(`${cases.length} cases written to ${dir}`);
