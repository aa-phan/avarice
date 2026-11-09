// The --agents JSON for one invocation (T-01-28). Built from GSD's agent markdown, entry by entry, so an agent
// the invocation does not name cannot be started and a definition that asks for a permission mode or hooks
// never reaches the file. The file lives in the invocation directory under the data root (mode 0600).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PURPOSE_EXTENSIONS } from '../../domain/invocation-scope.ts';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { AVARICE_RUN_SHELL_ADDENDUM } from '../../domain/run-shell-rules.ts';
import { parseAgentFile } from './agent-frontmatter.ts';

// A plain file name: no separator, no leading dot, so `..` and absolute paths are refused.
export const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// Two closing notes, by agent:
//  - D-03 (plan 02-09): the supervisor commits, never the model. GSD's executor ends every task with its own commit protocol
//    (`git add`, `git commit`), which the hook denies; this addendum tells it so instead of leaving it to retry. Appended to the
//    `gsd-executor` agent and to no other (the hook, the `.git` denyWrite and the moved-HEAD classifier rule stay the enforcement).
//  - Plan 03-34: the run's shell rules (AVARICE_RUN_SHELL_ADDENDUM) go to all four run agents, the executor's after its own text and before the
//    commit note. A subagent's refused shell calls count toward the same invocation's consecutive-denials limit (plan 03-27's diagnosis), and the
//    GSD prompts of these agents tell them to run gsd-tools, mkdir and git steps the hook refuses. The map and intel agents get neither note.
export const AVARICE_EXECUTOR_ADDENDUM =
  'AVARICE run: edit files only; the supervisor commits after the run\'s gates pass. Never run git add or git commit; report the task done with the files changed.';
const ADDENDUM_AGENT = 'gsd-executor';
const RUN_AGENTS: readonly string[] = PURPOSE_EXTENSIONS.run.agents;

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
    const closing = [
      ...(RUN_AGENTS.includes(name) ? [AVARICE_RUN_SHELL_ADDENDUM] : []),
      ...(name === ADDENDUM_AGENT ? [AVARICE_EXECUTOR_ADDENDUM] : []),
    ];
    agents[name] = {
      description,
      prompt: closing.length === 0 ? prompt : `${prompt.replace(/\s+$/, '')}\n\n${closing.join('\n\n')}\n`,
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
