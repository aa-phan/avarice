#!/usr/bin/env node
// summarize.mjs RUN.jsonl HOOK.log [GROUNDTRUTH.json]: reduce a stream-json transcript and a hook log to a digest.
// The digest holds counts, tool names, first lines of commands and short excerpts, never transcript bodies.
import fs from 'node:fs';

const [jsonl, hookLog, truthFile] = process.argv.slice(2);
const lines = fs.existsSync(jsonl) ? fs.readFileSync(jsonl, 'utf8').split('\n').filter(Boolean) : [];
const events = [];
for (const l of lines) { try { events.push(JSON.parse(l)); } catch { /* partial line */ } }
const excerpt = (s, n = 160) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);
const init = events.find((e) => e.type === 'system' && e.subtype === 'init');
const result = [...events].reverse().find((e) => e.type === 'result');
const toolCalls = {};
const bash = [];
const toolUses = new Map();
const errors = [];
const agentCalls = [];
for (const e of events) {
  const content = e.message?.content;
  if (!Array.isArray(content)) continue;
  for (const b of content) {
    if (b.type === 'tool_use') {
      toolCalls[b.name] = (toolCalls[b.name] ?? 0) + 1;
      toolUses.set(b.id, b.name);
      if (b.name === 'Bash') bash.push({ first_line: excerpt(String(b.input?.command ?? '').split('\n')[0], 200), lines: String(b.input?.command ?? '').split('\n').length, background: !!b.input?.run_in_background, subagent: !!e.parent_tool_use_id });
      if (b.name === 'Agent' || b.name === 'Task') agentCalls.push({ subagent_type: b.input?.subagent_type, model: b.input?.model, background: !!b.input?.run_in_background });
    }
    if (b.type === 'tool_result' && b.is_error) {
      const text = Array.isArray(b.content) ? b.content.map((x) => x.text ?? '').join(' ') : b.content;
      errors.push({ tool: toolUses.get(b.tool_use_id), excerpt: excerpt(text) });
    }
  }
}
let hooks = [];
if (hookLog && fs.existsSync(hookLog)) {
  hooks = fs.readFileSync(hookLog, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
const out = {
  init: init ? {
    model: init.model, permissionMode: init.permissionMode, cwd: init.cwd, tools: init.tools?.length,
    skills: (init.skills ?? []).map(String).filter((s) => /gsd|graphify/.test(s)).slice(0, 12), skillCount: (init.skills ?? []).length,
    slashGsd: (init.slash_commands ?? []).map(String).filter((s) => /gsd-map|graphify/.test(s)).slice(0, 8),
    agents: (init.agents ?? []).map(String).filter((s) => /gsd/.test(s)), plugins: init.plugins, memory_paths: init.memory_paths,
  } : null,
  result: result ? {
    subtype: result.subtype, is_error: result.is_error, terminal_reason: result.terminal_reason, total_cost_usd: result.total_cost_usd,
    duration_ms: result.duration_ms, num_turns: result.num_turns, text: excerpt(result.result, 240),
    permission_denials: (result.permission_denials ?? []).map((d) => ({ tool: d.tool_name, input: excerpt(JSON.stringify(d.tool_input), 160) })),
    modelUsage: Object.fromEntries(Object.entries(result.modelUsage ?? {}).map(([k, v]) => [k, { costUSD: v.costUSD }])),
    subagent_stats: result.subagent_stats ?? null,
    usage: result.usage ? { input: result.usage.input_tokens, cache_creation: result.usage.cache_creation_input_tokens, cache_read: result.usage.cache_read_input_tokens, output: result.usage.output_tokens } : null,
  } : null,
  toolCalls, bash, agentCalls, toolErrors: errors.slice(0, 40),
  hook: {
    calls: hooks.length,
    byDecision: hooks.reduce((m, h) => { m[h.decision] = (m[h.decision] ?? 0) + 1; return m; }, {}),
    byTool: hooks.reduce((m, h) => { const t = h.input?.tool_name; m[t] = (m[t] ?? 0) + 1; return m; }, {}),
    subagentCalls: hooks.filter((h) => h.input?.agent_id).length,
    allowedFirstLines: hooks.filter((h) => h.decision === 'allow').map((h) => excerpt(String(h.input?.tool_input?.command ?? '').split('\n')[0], 80)),
  },
  groundTruth: truthFile && fs.existsSync(truthFile) ? JSON.parse(fs.readFileSync(truthFile, 'utf8')) : null,
  eventCount: events.length,
};
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
