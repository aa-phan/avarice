Date: 2026-11-06, HEAD 0632fd4b66bd.

Code files:
- src/adapters/sqlite/ledger.ts: covered in part. Only the listRunEvents query and its row mapper (the read-only event listing the shell uses) were read; the other hunks of the large diff belong to other documents (runs, data-model, containment).
- src/cli/main.ts: covered.
- src/cli/render/run-view.ts: covered. Renderers of status and inbox are described by the shared-renderer paragraph only; their exact output forms are for cli-reference.
- src/cli/render/status-view.ts: covered as shared renderer; output form is for cli-reference.
- src/cli/render/style.ts: covered.
- src/cli/render/table.ts: covered.
- src/cli/shell/actions.ts: covered.
- src/cli/shell/history.ts: covered.
- src/cli/shell/home-view.ts: covered.
- src/cli/shell/line-editor.ts: covered.
- src/cli/shell/shell.ts: covered.

Counts (command, run at HEAD 2026-11-06):
- Menu actions: 7 of 7. Command: `grep -c "^const [a-zA-Z]*: ShellAction" src/cli/shell/actions.ts` gives 7, and the SHELL_ACTIONS array lists 7 names.
- Command names offered by completion: 10 of 10. `COMMANDS` in src/cli/main.ts line 12 lists ten names.
- History cap: 1000 (`grep -n "HISTORY_CAP = " src/cli/shell/history.ts` gives line 10).
- Watch view: 4 checkpoints (`slice(-4)`, src/cli/shell/actions.ts:141), 6 events (`listRunEvents(runId, 6)`, :137).

Alive proof: `grep -rn "runShell" src bin` shows one caller (src/cli/main.ts:60), reached when stdin and stdout are terminals and AVARICE_RUN is unset. The in-shell AVARICE_RUN refusal (shell.ts:532) is wired but its condition is excluded by that caller.

Not checked: no live terminal run; tests not read; the full diff of ledger.ts beyond listRunEvents; exact stderr/stdout text of status and inbox (cli-reference's); evidence files not used; whether `resolveProfile` fails in any case other than the config-reference list.
