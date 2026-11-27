# Coverage: containment (HEAD 0632fd4b66bdf15f858396ef8d65761f848ac448, 2026-11-06)

## Code files of the packet (diff base e725db6)

All covered (diff read and file read at HEAD) unless marked:
- src/adapters/exec/allowlist-proxy.ts: covered (new file)
- src/adapters/exec/sandboxed-executor.ts: covered
- src/adapters/exec/seatbelt-profile.ts: covered
- src/adapters/git/run-workspace.ts: covered
- src/adapters/git/safe-git.ts: covered
- src/adapters/gsd/agents-json.ts: covered (executor addendum)
- src/adapters/host-claude/claude-host.ts: covered
- src/adapters/host-claude/env.ts: covered
- src/adapters/host-claude/hook-policy.ts: covered
- src/adapters/host-claude/launch-preflight.ts: covered
- src/adapters/host-claude/settings.ts: covered
- src/app/budget.ts: covered in part (diff read; unchanged settlement code read at the settle function only)
- src/app/checks.ts: covered (new file); documented only its sandbox posture, the rest belongs to checks-and-evidence
- src/app/invocation.ts: covered in part (run functions and the shared finish path; the onboarding prepare function was not re-read line by line)
- src/app/run-gsd-config.ts: covered (seven settings and the prompt shape; the contract text composition and the context fence not described)
- src/app/run-stages/prepare.ts: covered for the verify-enforcement action and the install, validate and baseline hooks into checks; stage order belongs to runs
- src/domain/gates.ts: covered (G2 and G4 rules described only as scope and containment)
- src/domain/hook-decision.ts: covered
- src/domain/invocation-scope.ts: covered
- src/hook/pre-tool-use.ts: covered
- src/ports/command-executor.ts: covered

Also read, outside the packet: src/app/check-validation.ts, src/domain/outcome.ts, src/domain/run-contract.ts (preset and static G0, in part), src/domain/conventions.ts (refused words), src/app/run-stages/item.ts and blocked.ts and finish.ts (how G2, G4 and host errors block, in part), src/adapters/host-claude/launch-args.ts and invocation-files.ts, src/domain/policy-narrowing.ts, src/domain/root-rules.ts, src/adapters/fs/local-mount.ts, src/app/stages/activate.ts (lines 80 to 150), src/adapters/fs/profile-paths.ts (default roots, by grep), src/cli/composition.ts (by grep).

## Not checked
- src/domain/secret-patterns.ts, src/adapters/host-claude/stream-json.ts, skill-install.ts and avarice-run-skill.ts: not read (the skill text is an attended-session aid, not a control).
- src/domain/validation.ts (scope violation rules) and src/app/stages/validate.ts: not read; the activation scope check is described from activate.ts and the previous document.
- Evidence files, test files and live-run results: not read.
- No Seatbelt, hook or host process was run.

## Counts, each N of M with the command (run at HEAD)

- Hook rule IDs: 33 distinct. Command: `grep -ohE "(return |deny\(|_RULE = |\?\?= |null : |rule: |rule: seen[.]agentCommand [?] )'[a-z]+([-:_][a-zA-Z]+)*'( : '[a-z-]+')?" src/domain/hook-decision.ts src/hook/pre-tool-use.ts | grep -oE "'[^']+'" | sort -u | wc -l`. Result 33, equal to a manual read of every emission site. Split: 6 allow (write-set, read-set, subagent-type, meta, shell-identity, agent-command), 28 deny; subagent-type is on both, so 6 + 28 - 1 = 33. The old ledger's 5 allow and 21 deny does not match any definition; the old pin was not re-derived.
- Read-only commands: 11. Command: `sed -n '/^export const READ_ONLY_COMMANDS/,/^\];/p' src/domain/invocation-scope.ts | grep -c "^  '"`.
- Denied prefixes: 16. Same command on `DENIED_COMMAND_PREFIXES`.
- Denied find actions: 10. Same command on `FIND_DENIED_ACTIONS`.
- GSD verbs: map 11 (same command on `GSD_BASE_VERBS`), intel 14 (11 + 3 in `GSD_INTEL_VERBS`), run 14 (11 + 3 listed in `GSD_READ_VERBS.run`), knowledge 0.
- Required settings keys: 9. Command: `sed -n '/^const REQUIRED_KEYS/,/^\];/p' src/adapters/host-claude/launch-preflight.ts | grep -c "^  \[\["`.
- Admitted host versions: 4. Command: `grep -n "ADMITTED_CLAUDE_VERSIONS: " src/adapters/host-claude/launch-preflight.ts` (2.1.312, 2.1.316, 2.1.317, 2.1.318).
- Budgets: 5 for an onboarding and 5 for a run. Command: read of `budgetRowsOf` and `budgetRowsOfRun` in src/app/budget.ts.
- Event kinds written by packet files: 6 (hook.decision, loop.limit, tool.completed, config.change.denied, invocation.finished, invocation.orphan-charged), plus check.finished and check.validated pointed to checks-and-evidence. Command: `grep -noE "type: '[a-z.:-]+'" src/hook/pre-tool-use.ts src/app/budget.ts src/app/invocation.ts src/app/checks.ts src/app/check-validation.ts`.
- Dead, dormant or alive: the narrow-rules and hook-allow strategies are dormant (supported, no production caller). Commands: `grep -rln "narrow-rules\|hook-allow" src` lists only settings.ts, hook-decision.ts and invocation-scope.ts, and `grep -rn "strategy" src/app src/cli` shows no caller passing one, so the blanket default applies. The egress proxy is alive: composed in src/cli/composition.ts and used from src/app/checks.ts and src/app/check-validation.ts.
- Sentence cap checked with a script over prose lines (tables, lists and headings excluded): no sentence over 35 words. No em or en dash.
