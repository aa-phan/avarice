# Coverage: cli-reference (denominators re-derived at HEAD 0632fd4)

Code files of the packet:
- src/adapters/host-claude/avarice-run-skill.ts: covered
- src/adapters/host-claude/skill-install.ts: covered
- src/app/run-start.ts: covered (refusal codes, brief limits, order of checks; contract compile internals left to runs.md)
- src/app/run-status.ts: covered
- src/app/status.ts: covered
- src/cli/args.ts: covered
- src/cli/commands/inbox.ts: covered
- src/cli/commands/init.ts: covered
- src/cli/commands/install-host.ts: covered
- src/cli/commands/onboard.ts: covered (diff is the shared budget parser; no behavior change)
- src/cli/commands/repo.ts: covered
- src/cli/commands/resume.ts: covered
- src/cli/commands/start.ts: covered
- src/cli/commands/status.ts: covered
- src/cli/commands/supervise.ts: covered
- src/cli/composition.ts: covered in part (adapter recording, read-only paths, GSD location; host construction details left to containment.md)
- src/cli/main.ts: covered
- src/cli/render/run-view.ts: covered
- src/cli/render/status-view.ts: covered
- src/cli/render/style.ts: covered (colourEnabled is used only by the shell, so not documented here)
- src/cli/render/table.ts: covered
- src/cli/spawn-supervisor.ts: covered

Counts:
- CLI commands: 10 of 10 (`grep -n "COMMANDS =" src/cli/main.ts`, line 12)
- Commands with a `--json` form: 3 of 10 (`grep -n "booleanFlags" src/cli/commands/*.ts`: status, inbox, context)
- Commands with a `--wait` flag: 2 of 10 (same command: start, resume)
- Start refusal codes: 10 of 10 (4 via `grep -n "refused('" src/app/run-start.ts` plus 6 in `PreflightCode` at src/domain/run-preflight.ts:9)
- Exit codes: 4 of 4 (0, 3, 64, 70; `grep -rnE "EXIT_[A-Z_]+ = [0-9]+" src/cli`; no other literal exit)
- Output forms: both forms of status, inbox and context; text only for the other seven (no `--json` declared)

Not checked: `src/cli/shell/` beyond the dispatch conditions; `src/app/context.ts` and the context adapters (unchanged since the diff base); `acquireRunLease` semantics; no command was executed, so every output line is from reading the renderers.

Wiring proofs: the ten commands are alive through the `COMMANDS` allowlist and dynamic import (`src/cli/main.ts:12,71`); `bin/avarice.ts` calls `main`. `colourEnabled` is dormant for the one-shot commands: `grep -rn colourEnabled src` shows only the shell.
