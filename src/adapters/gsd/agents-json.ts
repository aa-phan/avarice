// The --agents JSON for one invocation (T-01-28). Built from GSD's agent markdown, entry by entry, so an agent
// the invocation does not name cannot be started and a definition that asks for a permission mode or hooks
// never reaches the file. The file lives in the invocation directory under the data root (mode 0600).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { parseAgentFile } from './agent-frontmatter.ts';

// A plain file name: no separator, no leading dot, so `..` and absolute paths are refused.
export const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// D-03 (plan 02-09): the supervisor commits, never the model. GSD's executor ends every task with its own commit protocol
// (`git add`, `git commit`), which the hook denies; this addendum tells it so instead of leaving it to retry. Appended to the
// `gsd-executor` agent and to no other (the hook, the `.git` denyWrite and the moved-HEAD classifier rule stay the enforcement).
export const AVARICE_EXECUTOR_ADDENDUM =
  'AVARICE run: edit files only; the supervisor commits after the run\'s gates pass. Never run git add or git commit; report the task done with the files changed.';
const ADDENDUM_AGENT = 'gsd-executor';

export function buildAgentsJson(agentsDir: string, names: readonly string[], outFile: string): Result<{ file: string; agents: string[] }> {
  const agents: Record<string, unknown> = {};
  for (const name of names) {
    if (!PLAIN_NAME.test(name)) return err({ kind: 'invalid', field: 'agent', reason: `${JSON.stringify(name)} is not a plain agent name` });
    let text: string;
    try {
      text = readFileSync(join(agentsDir, `${name}.md`), 'utf8');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return err({ kind: 'not_found', ref: `agent:${name}` });
      return err({ kind: 'internal', cause: `cannot read agent ${name}: ${code ?? 'unreadable'}` });
    }
    const parsed = parseAgentFile(text);
    if (!parsed.ok) {
      return parsed.error.kind === 'invalid'
        ? err({ kind: 'invalid', field: `agent:${name}:${parsed.error.field}`, reason: parsed.error.reason })
        : parsed;
    }
    const { description, prompt, tools, disallowedTools, effort } = parsed.value;
    agents[name] = {
      description,
      prompt: name === ADDENDUM_AGENT ? `${prompt.replace(/\s+$/, '')}\n\n${AVARICE_EXECUTOR_ADDENDUM}\n` : prompt,
      ...(tools !== undefined ? { tools } : {}),
      ...(disallowedTools !== undefined ? { disallowedTools } : {}),
      ...(effort !== undefined ? { effort } : {}),
    };
  }

  try {
    mkdirSync(dirname(outFile), { recursive: true, mode: 0o700 });
    // Write beside the target and rename, so an existing wider file is replaced, never kept.
    const temp = `${outFile}.tmp-${process.pid}`;
    writeFileSync(temp, JSON.stringify(agents), { mode: 0o600 });
    renameSync(temp, outFile);
  } catch (e) {
    return err({ kind: 'internal', cause: `cannot write the agents file: ${(e as NodeJS.ErrnoException).code ?? 'write failed'}` });
  }
  return ok({ file: outFile, agents: Object.keys(agents) });
}
