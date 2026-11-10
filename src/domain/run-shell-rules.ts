// The shell rules of a run, stated once (plan 03-34; the 03-27 diagnosis in spikes/phase-3-wave-0/S3-B-small-unit-haiku.md). A small item on haiku
// did not complete in two live runs because the unit prompt never said what the hook admits, told the unit to run a workflow whose own shell steps
// the hook refuses, and the refusals named a rule and nothing else. These texts are what the unit prompt, the run agents' prompts and the hook's shell
// refusals say, so the three cannot drift apart. They state rules the hook already enforces and grant nothing: the admitted commands stay the contract's
// commands and READ_ONLY_COMMANDS.
import { READ_ONLY_COMMANDS } from './invocation-scope.ts';

// The forms the hook refuses outside quotes (docs/system/containment.md, "Command identity (Bash)", rules 5 and 9), in the words the model reads.
export const RUN_REFUSED_FORMS = "';', '&&', '||', a redirection such as '2>&1', '$(...)', backticks, a word that starts with '~', and an unquoted '*', '?', '[' or '{'";

export const RUN_SHELL_RULES_SENTENCE = `Shell rules: run one plain command per Bash call. A call is refused if it contains ${RUN_REFUSED_FORMS}. Write every path relative to the working directory, which is the repository root.`;

// The read-only commands the hook admits beside the contract's commands, one per call, with operands inside the repository.
export const readOnlyCommandsSentence = (commands: readonly string[]): string =>
  `You may also run these read-only commands, one per call, on paths inside the repository: ${commands.join(', ')}. Read files with the Read tool and search with the Grep and Glob tools.`;

// What a refused shell call is told besides its rule (plan 03-34): the admitted spelling, so a refused form is not retried unchanged until the
// consecutive-denials limit ends the invocation (CON-14). Built from fixed text and the policy's own command names, so it never repeats the refused
// command and never names a path. `agentCommands` are the contract's commands as the policy holds them (a `<paths>` entry ends in `<paths>`).
export interface ShellAdmitted {
  readOnly: readonly string[];
  agentCommands: readonly string[];
}

const FILE_TOOLS = 'read files with the Read tool and search with the Grep and Glob tools';

function admittedText({ readOnly, agentCommands }: ShellAdmitted): string {
  const readOnlyText = `the read-only commands, one per call: ${readOnly.join(', ')}`;
  return agentCommands.length === 0 ? readOnlyText : `the commands listed for this run, exactly as written: ${agentCommands.join(', ')}; and ${readOnlyText}`;
}

// A reason for `shell-syntax`, `shell-not-allowed` and `shell-denied-prefix`; undefined for every other rule.
export function shellRuleReason(rule: string, lists: ShellAdmitted): string | undefined {
  switch (rule) {
    case 'shell-syntax':
      return `one plain command per call, written without ${RUN_REFUSED_FORMS}; ${FILE_TOOLS}`;
    case 'shell-not-allowed':
      return `this command is not admitted; the admitted commands are ${admittedText(lists)}; ${FILE_TOOLS}`;
    case 'shell-denied-prefix':
      return `this command is never run inside an invocation unless it is listed exactly as written among the commands you may run; the admitted commands are ${admittedText(lists)}; ${FILE_TOOLS}`;
    default:
      return undefined;
  }
}

// The closing note of every run agent's prompt (plan 03-34): the planner, plan checker, executor and verifier run in the same invocation as the unit,
// their refusals count toward the same loop limit, and their GSD prompts tell them to run gsd-tools, mkdir and git steps the hook refuses.
export const AVARICE_RUN_SHELL_ADDENDUM = `${RUN_SHELL_RULES_SENTENCE} ${readOnlyCommandsSentence(READ_ONLY_COMMANDS)} Do not run gsd-tools, mkdir or a git command that changes the repository; create files with the Write tool, which creates missing directories.`;

// RED stub (plan 03-43): the text is written in the next commit.
export const RUN_RECORDS_SENTENCE = '';

// The quick workflow's own shell steps are outside the run's command list, and a unit that reads both instructions literally stops (haiku, run 2 of plan
// 03-27). It does that work with the file tools and the agents instead, and still runs the four stages.
export const RUN_WORKFLOW_SHELL_SENTENCE =
  "Do not run the quick workflow's gsd-tools queries, its mkdir steps or its git steps that change the repository (add, commit, switch, checkout), and do not stop because of them. Choose the quick task's directory under .planning/quick/ yourself, create every file with the Write tool (it creates missing directories), and start the planner, plan-checker, executor and verifier with the Agent tool, giving each the paths, commands, shell rules and acceptance criteria above.";
