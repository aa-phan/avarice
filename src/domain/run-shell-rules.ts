// The shell rules of a run, stated once (plan 03-34; the 03-27 diagnosis in spikes/phase-3-wave-0/S3-B-small-unit-haiku.md). A small item on haiku
// did not complete in two live runs because the unit prompt never said what the hook admits, told the unit to run a workflow whose own shell steps
// the hook refuses, and the refusals named a rule and nothing else. These texts are what the unit prompt, the run agents' prompts and the hook's shell
// refusals say, so the three cannot drift apart. They state rules the hook already enforces and grant nothing: the admitted commands stay the contract's
// commands and READ_ONLY_COMMANDS.

// The forms the hook refuses outside quotes (docs/system/containment.md, "Command identity (Bash)", rules 5 and 9), in the words the model reads.
export const RUN_REFUSED_FORMS = "';', '&&', '||', a redirection such as '2>&1', '$(...)', backticks, a word that starts with '~', and an unquoted '*', '?', '[' or '{'";

export const RUN_SHELL_RULES_SENTENCE = `Shell rules: run one plain command per Bash call. A call is refused if it contains ${RUN_REFUSED_FORMS}. Write every path relative to the working directory, which is the repository root.`;

// The read-only commands the hook admits beside the contract's commands, one per call, with operands inside the repository.
export const readOnlyCommandsSentence = (commands: readonly string[]): string =>
  `You may also run these read-only commands, one per call, on paths inside the repository: ${commands.join(', ')}. Read files with the Read tool and search with the Grep and Glob tools.`;

// The quick workflow's own shell steps are outside the run's command list, and a unit that reads both instructions literally stops (haiku, run 2 of plan
// 03-27). It does that work with the file tools and the agents instead, and still runs the four stages.
export const RUN_WORKFLOW_SHELL_SENTENCE =
  "Do not run the quick workflow's gsd-tools queries, its mkdir steps or its git steps that change the repository (add, commit, switch, checkout), and do not stop because of them. Choose the quick task's directory under .planning/quick/ yourself, create every file with the Write tool (it creates missing directories), and start the planner, plan-checker, executor and verifier with the Agent tool, giving each the paths, commands, shell rules and acceptance criteria above.";
