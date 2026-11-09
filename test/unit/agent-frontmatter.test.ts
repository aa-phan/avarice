// GSD agents and skills as launch inputs (CS-15 precondition, T-01-28): the agent markdown reader, the
// --agents JSON builder and the generated plugin directory with symlinked skills.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

import { parseAgentFile } from '../../src/adapters/gsd/agent-frontmatter.ts';
import { AVARICE_EXECUTOR_ADDENDUM, buildAgentsJson } from '../../src/adapters/gsd/agents-json.ts';
import { PURPOSE_EXTENSIONS, buildPluginDir } from '../../src/adapters/gsd/plugin-dir.ts';
import { READ_ONLY_COMMANDS } from '../../src/domain/invocation-scope.ts';
import { AVARICE_RUN_SHELL_ADDENDUM } from '../../src/domain/run-shell-rules.ts';

const MAPPER = `---
name: gsd-codebase-mapper
description: Explores codebase and writes structured analysis documents. Spawned by map-codebase with a focus area (tech, arch, quality, concerns).
tools: Read, Bash, Grep, Glob, Write, Skill
color: cyan
# hooks:
#   PostToolUse:
#     - matcher: "Write|Edit"
#       hooks:
#         - type: command
#           command: "npx eslint --fix $FILE 2>/dev/null || true"
effort: low
---

<role>
You are a GSD codebase mapper.
</role>
`;

const INTEL = `---
name: gsd-intel-updater
description: Analyzes codebase and writes structured intel files to .planning/intel/.
tools: Read, Write, Bash, Glob, Grep
color: cyan
# hooks:
effort: low
---
body of the intel updater
`;

let root = '';
before(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-agents-')));
});
after(() => {
  rmSync(root, { recursive: true, force: true });
});

function parsed(text: string) {
  const r = parseAgentFile(text);
  assert.ok(r.ok, JSON.stringify(r));
  return r.value;
}

function rejected(text: string): { field: string; reason: string } {
  const r = parseAgentFile(text);
  assert.ok(!r.ok, 'expected a rejection');
  assert.ok(!r.ok && r.error.kind === 'invalid', JSON.stringify(r));
  return r.ok || r.error.kind !== 'invalid' ? { field: '', reason: '' } : { field: r.error.field, reason: r.error.reason };
}

describe('parseAgentFile', () => {
  it('reads the mapper: description, the tool list and the body as the prompt', () => {
    const agent = parsed(MAPPER);
    assert.match(agent.description, /^Explores codebase and writes structured analysis documents/);
    assert.deepEqual(agent.tools, ['Read', 'Bash', 'Grep', 'Glob', 'Write', 'Skill']);
    assert.equal(agent.effort, 'low');
    assert.match(agent.prompt, /^<role>\nYou are a GSD codebase mapper\./);
    assert.ok(!agent.prompt.includes('name: gsd-codebase-mapper'));
  });

  it('drops name and color and every key it does not carry', () => {
    const agent = parsed(MAPPER) as unknown as Record<string, unknown>;
    assert.deepEqual(Object.keys(agent).sort(), ['description', 'effort', 'prompt', 'tools']);
  });

  it('ignores commented hooks blocks (GSD agents ship them commented out)', () => {
    assert.doesNotThrow(() => parsed(INTEL));
  });

  it('rejects permissionMode (CS-15 precondition)', () => {
    const bad = MAPPER.replace('color: cyan', 'permissionMode: acceptEdits');
    const r = rejected(bad);
    assert.equal(r.field, 'permissionMode');
  });

  it('rejects an uncommented hooks key, including a block form', () => {
    const bad = MAPPER.replace('# hooks:', 'hooks:').replace('#   PostToolUse:', '  PostToolUse:');
    assert.equal(rejected(bad).field, 'hooks');
    assert.equal(rejected(MAPPER.replace('color: cyan', 'hooks: {}')).field, 'hooks');
  });

  it('reads a YAML list for tools and disallowedTools, and a comma list for disallowedTools', () => {
    const text = `---
name: a
description: d
tools:
  - Read
  - Grep
disallowedTools: WebFetch, WebSearch
---
p
`;
    const agent = parsed(text);
    assert.deepEqual(agent.tools, ['Read', 'Grep']);
    assert.deepEqual(agent.disallowedTools, ['WebFetch', 'WebSearch']);
  });

  it('strips quotes from scalars and keeps colons inside a description', () => {
    const agent = parsed(`---\nname: a\ndescription: "Writes docs: all of them"\n---\nbody\n`);
    assert.equal(agent.description, 'Writes docs: all of them');
    assert.equal(agent.tools, undefined);
  });

  it('reads a folded block scalar description', () => {
    const agent = parsed(`---\nname: a\ndescription: >\n  first line\n  second line\ntools: Read\n---\nbody\n`);
    assert.equal(agent.description, 'first line second line');
    assert.deepEqual(agent.tools, ['Read']);
  });

  it('rejects a file without frontmatter or without a description', () => {
    assert.equal(rejected('just a body\n').field, 'frontmatter');
    assert.equal(rejected('---\nname: a\ntools: Read\n---\nbody\n').field, 'description');
  });

  it('parses the installed gsd-codebase-mapper when this machine has one', { skip: !existsSync(join(homedir(), '.claude', 'agents', 'gsd-codebase-mapper.md')) }, () => {
    const agent = parsed(readFileSync(join(homedir(), '.claude', 'agents', 'gsd-codebase-mapper.md'), 'utf8'));
    assert.ok((agent.tools ?? []).includes('Write'));
    assert.ok(agent.prompt.length > 100);
  });
});

function writeAgents(dir: string, files: Record<string, string>): void {
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, `${name}.md`), text);
}

describe('buildAgentsJson', () => {
  it('writes a 0600 JSON object keyed by agent name', () => {
    const dir = join(root, 'agents-a');
    writeAgents(dir, { 'gsd-codebase-mapper': MAPPER, 'gsd-intel-updater': INTEL });
    const out = join(root, 'out-a', 'agents.json');
    const r = buildAgentsJson(dir, ['gsd-codebase-mapper'], out);
    assert.ok(r.ok, JSON.stringify(r));
    const json = JSON.parse(readFileSync(out, 'utf8'));
    assert.deepEqual(Object.keys(json), ['gsd-codebase-mapper']);
    assert.deepEqual(json['gsd-codebase-mapper'].tools, ['Read', 'Bash', 'Grep', 'Glob', 'Write', 'Skill']);
    assert.equal(json['gsd-codebase-mapper'].effort, 'low');
    assert.match(json['gsd-codebase-mapper'].prompt, /GSD codebase mapper/);
    assert.equal(json['gsd-codebase-mapper'].permissionMode, undefined);
    assert.equal(statSync(out).mode & 0o777, 0o600);
  });

  it('tightens the mode of an existing wider file', () => {
    const dir = join(root, 'agents-b');
    writeAgents(dir, { 'gsd-intel-updater': INTEL });
    const out = join(root, 'out-b.json');
    writeFileSync(out, '{}');
    chmodSync(out, 0o644);
    assert.ok(buildAgentsJson(dir, ['gsd-intel-updater'], out).ok);
    assert.equal(statSync(out).mode & 0o777, 0o600);
  });

  it('writes an empty object for no agents', () => {
    const out = join(root, 'out-c.json');
    assert.ok(buildAgentsJson(join(root, 'agents-a'), [], out).ok);
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), {});
  });

  it('refuses an unknown agent name and writes nothing', () => {
    const dir = join(root, 'agents-d');
    writeAgents(dir, { 'gsd-intel-updater': INTEL });
    const out = join(root, 'out-d.json');
    const r = buildAgentsJson(dir, ['gsd-intel-updater', 'gsd-nope'], out);
    assert.ok(!r.ok && r.error.kind === 'not_found', JSON.stringify(r));
    assert.ok(!existsSync(out));
  });

  it('refuses an agent that sets permissionMode or hooks, and writes nothing (T-01-28)', () => {
    const dir = join(root, 'agents-e');
    writeAgents(dir, {
      'gsd-ok': INTEL,
      'gsd-elevated': INTEL.replace('color: cyan', 'permissionMode: bypassPermissions'),
      'gsd-hooked': INTEL.replace('# hooks:', 'hooks: {}'),
    });
    for (const name of ['gsd-elevated', 'gsd-hooked']) {
      const out = join(root, `out-e-${name}.json`);
      const r = buildAgentsJson(dir, ['gsd-ok', name], out);
      assert.ok(!r.ok && r.error.kind === 'invalid', `${name}: ${JSON.stringify(r)}`);
      assert.ok(!existsSync(out), `${name}: no file may be written`);
    }
  });

  it('appends the AVARICE no-commit addendum to gsd-executor and to no other agent (D-03; plan 02-09)', () => {
    const dir = join(root, 'agents-g');
    const EXECUTOR = INTEL.replace('gsd-intel-updater', 'gsd-executor').replace(/\n$/, '\nYou are a GSD executor.\n');
    writeAgents(dir, { 'gsd-executor': EXECUTOR, 'gsd-planner': INTEL.replace('gsd-intel-updater', 'gsd-planner'), 'gsd-codebase-mapper': MAPPER });
    const out = join(root, 'out-g.json');
    const r = buildAgentsJson(dir, ['gsd-executor', 'gsd-planner', 'gsd-codebase-mapper'], out);
    assert.ok(r.ok, JSON.stringify(r));
    const json = JSON.parse(readFileSync(out, 'utf8'));
    const sentence = 'AVARICE run: edit files only; the supervisor commits after the run\'s gates pass. Never run git add or git commit; report the task done with the files changed.';
    assert.equal(AVARICE_EXECUTOR_ADDENDUM, sentence);
    assert.match(json['gsd-executor'].prompt, /You are a GSD executor\./);
    assert.equal(json['gsd-executor'].prompt.endsWith(`\n\n${sentence}\n`), true);
    assert.equal(json['gsd-executor'].prompt.split(sentence).length, 2, 'the addendum appears once');
    for (const other of ['gsd-planner', 'gsd-codebase-mapper']) assert.equal(json[other].prompt.includes(sentence), false, `${other} gets no commit addendum`);
  });

  it("appends the run's shell-rules addendum to the four run agents, before the executor's commit addendum, and to no map or intel agent (plan 03-34)", () => {
    const dir = join(root, 'agents-h');
    const agent = (name: string): string => INTEL.replace('gsd-intel-updater', name).replace(/\n$/, `\nYou are ${name}.\n`);
    const files: Record<string, string> = { 'gsd-codebase-mapper': MAPPER, 'gsd-intel-updater': INTEL };
    for (const name of PURPOSE_EXTENSIONS.run.agents) files[name] = agent(name);
    writeAgents(dir, files);
    const out = join(root, 'out-h.json');
    const r = buildAgentsJson(dir, [...PURPOSE_EXTENSIONS.run.agents, 'gsd-codebase-mapper', 'gsd-intel-updater'], out);
    assert.ok(r.ok, JSON.stringify(r));
    const json = JSON.parse(readFileSync(out, 'utf8'));
    assert.deepEqual([...PURPOSE_EXTENSIONS.run.agents], ['gsd-planner', 'gsd-plan-checker', 'gsd-executor', 'gsd-verifier']);
    for (const name of PURPOSE_EXTENSIONS.run.agents) {
      const prompt: string = json[name].prompt;
      assert.match(prompt, new RegExp(`You are ${name}\\.`));
      assert.equal(prompt.split(AVARICE_RUN_SHELL_ADDENDUM).length, 2, `${name}: the shell addendum appears once`);
      const closing = name === 'gsd-executor' ? `\n\n${AVARICE_RUN_SHELL_ADDENDUM}\n\n${AVARICE_EXECUTOR_ADDENDUM}\n` : `\n\n${AVARICE_RUN_SHELL_ADDENDUM}\n`;
      assert.equal(prompt.endsWith(closing), true, `${name}: the prompt closes with ${name === 'gsd-executor' ? 'the shell addendum, then the commit addendum' : 'the shell addendum'}`);
      assert.equal(prompt.includes(AVARICE_EXECUTOR_ADDENDUM), name === 'gsd-executor', `${name}: the commit addendum belongs to the executor alone`);
    }
    for (const name of ['gsd-codebase-mapper', 'gsd-intel-updater']) {
      assert.equal(json[name].prompt.includes(AVARICE_RUN_SHELL_ADDENDUM), false, `${name}: no shell addendum`);
      assert.equal(json[name].prompt.includes(AVARICE_EXECUTOR_ADDENDUM), false, `${name}: no commit addendum`);
    }
    assert.equal(json['gsd-intel-updater'].prompt, 'body of the intel updater', 'an agent outside the run keeps its prompt as the parser reads it');
  });

  it('writes an addendum that states the rules: one plain command per call, every read-only command, the file tools, and no gsd-tools, mkdir or repository-changing git', () => {
    assert.match(AVARICE_RUN_SHELL_ADDENDUM, /one plain command per Bash call/);
    for (const command of READ_ONLY_COMMANDS) assert.ok(AVARICE_RUN_SHELL_ADDENDUM.includes(command), command);
    for (const tool of ['Read', 'Grep', 'Glob']) assert.ok(AVARICE_RUN_SHELL_ADDENDUM.includes(tool), tool);
    for (const word of ['gsd-tools', 'mkdir', 'git command that changes the repository', 'Write']) assert.ok(AVARICE_RUN_SHELL_ADDENDUM.includes(word), word);
    assert.equal(AVARICE_RUN_SHELL_ADDENDUM.includes('AVARICE run:'), false, 'it is not the executor commit sentence');
  });

  it('refuses names that are not plain file names', () => {
    const dir = join(root, 'agents-f');
    writeAgents(dir, { 'gsd-intel-updater': INTEL });
    for (const name of ['../agents-a/gsd-codebase-mapper', '/etc/passwd', 'a/b', '', '.hidden']) {
      const r = buildAgentsJson(dir, [name], join(root, 'out-f.json'));
      assert.ok(!r.ok && r.error.kind === 'invalid', `${JSON.stringify(name)}: ${JSON.stringify(r)}`);
    }
  });
});

describe('buildPluginDir', () => {
  function skillsRoot(...names: string[]): string {
    const dir = join(root, `skills-${names.join('-') || 'none'}`);
    for (const name of names) {
      mkdirSync(join(dir, name), { recursive: true });
      writeFileSync(join(dir, name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
    }
    return dir;
  }

  it('writes plugin.json and one symlink per skill, pointing at the realpath of the skill directory', () => {
    const skills = skillsRoot('gsd-map-codebase', 'graphify');
    const out = join(root, 'plugin-a');
    const r = buildPluginDir(out, skills, ['gsd-map-codebase']);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(readFileSync(join(out, '.claude-plugin', 'plugin.json'), 'utf8').trim(), '{"name":"avarice-run-skills","version":"0.0.0"}');
    const link = join(out, 'skills', 'gsd-map-codebase');
    assert.ok(lstatSync(link).isSymbolicLink());
    assert.equal(readlinkSync(link), realpathSync(join(skills, 'gsd-map-codebase')));
    assert.ok(!existsSync(join(out, 'skills', 'graphify')));
  });

  it('follows a symlinked skill to its real directory', () => {
    const real = join(root, 'elsewhere', 'graphify');
    mkdirSync(real, { recursive: true });
    writeFileSync(join(real, 'SKILL.md'), '---\nname: graphify\n---\n');
    const skills = join(root, 'skills-linked');
    mkdirSync(skills, { recursive: true });
    symlinkSync(real, join(skills, 'graphify'));
    const out = join(root, 'plugin-b');
    assert.ok(buildPluginDir(out, skills, ['graphify']).ok);
    assert.equal(readlinkSync(join(out, 'skills', 'graphify')), realpathSync(real));
  });

  it('refuses a skill that is missing under the root and creates no plugin', () => {
    const skills = skillsRoot('graphify');
    const out = join(root, 'plugin-c');
    const r = buildPluginDir(out, skills, ['gsd-map-codebase']);
    assert.ok(!r.ok && r.error.kind === 'not_found', JSON.stringify(r));
    assert.ok(!existsSync(join(out, 'skills', 'gsd-map-codebase')));
  });

  it('removes links left by an earlier build, so a stale skill cannot load', () => {
    const skills = skillsRoot('gsd-map-codebase', 'graphify');
    const out = join(root, 'plugin-d');
    assert.ok(buildPluginDir(out, skills, ['gsd-map-codebase', 'graphify']).ok);
    assert.ok(buildPluginDir(out, skills, ['graphify']).ok);
    assert.ok(!existsSync(join(out, 'skills', 'gsd-map-codebase')));
    assert.ok(lstatSync(join(out, 'skills', 'graphify')).isSymbolicLink());
  });

  it('builds a plugin with no skills (the intel seam needs none)', () => {
    const out = join(root, 'plugin-e');
    const r = buildPluginDir(out, skillsRoot('graphify'), []);
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok(existsSync(join(out, '.claude-plugin', 'plugin.json')));
    assert.deepEqual(r.ok ? r.value.skills : null, []);
  });

  it('refuses names that are not plain directory names', () => {
    const skills = skillsRoot('graphify');
    for (const name of ['../skills-graphify/graphify', '/etc', 'a/b', '', '..']) {
      const r = buildPluginDir(join(root, 'plugin-f'), skills, [name]);
      assert.ok(!r.ok && r.error.kind === 'invalid', `${JSON.stringify(name)}: ${JSON.stringify(r)}`);
    }
  });

  it('names the per-purpose allowances (S0-D: intel loads no skill; plan 01-19 decision B: knowledge loads none either)', () => {
    assert.deepEqual(PURPOSE_EXTENSIONS.map, { skills: ['gsd-map-codebase'], agents: ['gsd-codebase-mapper'] });
    assert.deepEqual(PURPOSE_EXTENSIONS.intel, { skills: [], agents: ['gsd-intel-updater'] });
    assert.deepEqual(PURPOSE_EXTENSIONS.knowledge, { skills: [], agents: [] });
  });
});
