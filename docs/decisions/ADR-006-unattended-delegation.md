# ADR-006: Unattended runs delegate bounded GSD units through contained headless invocations and route every GSD pause

| | |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-10-29 |
| **Deciders** | aa-phan |
| **Supersedes** | For unattended runs, the "Stage 1 manual handoff only" part of [ADR-002](ADR-002-gsd-integration-mode.md) and its "never orchestrates the loop" title: the supervisor starts each unit and retries a crashed invocation once (CON-16), but never steps inside a GSD unit. ADR-002's ownership table still holds. |

## Context

UC-8 and RC-4 require progress from requirements to verification without phase-transition prompts. ADR-002 left the user to start each GSD command by hand in AVARICE (Agent Verification, Automation, Runtime Integration, and Coordination Environment). GSD 1.17.0 was inspected for unattended support on 2026-10-29:

- No headless or CI mode exists. `workflow.text_mode` replaces AskUserQuestion with plain-text numbered lists (`workflows/quick.md:50`).
- `/gsd-autonomous` "[p]auses only for explicit user decisions (grey area acceptance, blockers, validation requests)" (`workflows/autonomous.md:5`). It invokes plan and execute without `--auto` (`autonomous.md:384, 413`), and execute-phase clears the auto-chain flag when `--auto` is absent, so checkpoint auto-approval inside it depends on `workflow.auto_advance` (`bin/lib/check-auto-mode.cjs:21-31`).
- In auto mode, `human-verify` checkpoints auto-approve, a `checkpoint:decision` auto-selects only with a declared `auto_select` and otherwise escalates, `human-action` always stops, and `gate="blocking-human"` is never auto-approved (`references/checkpoints.md:11-23`).
- `discuss-phase --auto` chooses "the recommended option (first option, or the one explicitly marked 'recommended') without using AskUserQuestion" (`workflows/discuss-phase/modes/auto.md`).
- `state signal-waiting` writes `.planning/WAITING.json`, but no workflow, agent or reference calls it (grep over `workflows/`, `references/`, `agents/`, `commands/` returned no callers).
- Verification overrides carry an `accepted_by` string that no code checks (`references/verification-overrides.md`). Node repair can PRUNE a task autonomously (`workflows/node-repair.md:26`). Declared-scope conformance at merge "does not block the merge" (`workflows/execute-phase/steps/executor-isolation-dispatch.md:373`).
- GSD has no token, cost or tool-call budgets.

Claude Code 2.1.312, and 2.1.316 on re-check, offers headless invocations (`claude -p`) with `--settings`, `--permission-mode dontAsk`, `--permission-prompts none`, `--max-budget-usd`, `--resume` and stream-json output (`claude --help`). [containment.md](../containment.md) defines the containment around them.

## Decision

1. A run is driven by an AVARICE **supervisor** process that lives only for the run. It starts headless host invocations, one GSD unit per invocation, inside the containment of [containment.md](../containment.md). It never drives GSD steps inside a unit.
2. The MVP unit is `/gsd-quick --validate --text "<contract-derived task>"` for one work item. Phased work uses `/gsd-autonomous --only <N>` with `workflow.auto_advance=true` after the integration suite has tested the possible double-execute path (plan-phase chaining into execute while autonomous also calls execute).
3. Before the first invocation, AVARICE sets run-specific GSD configuration in the run's own worktree through `gsd_run config-set`: `workflow.text_mode=true`, `gates.execute_next_plan=false`, `gates.confirm_transition=false`, `workflow.windows_enforce=true`, `audit.enabled=true`. Routine transition prompts are removed by configuration. AVARICE never uses `discuss --auto` or `discuss-phase-assumptions --auto`, and keeps reversibility gates on.
4. When an invocation ends, AVARICE classifies the outcome deterministically from the stream-json `result`, `permission_denials`, `WAITING.json`, `state.json` and `HEAD` movement, STATE.md `needs_human` entries and VERIFICATION.md status. An invocation that ends without progress and with a question is a **GSD pause**.
5. A GSD pause is answered only by a validated human decision, or by an authorized default the contract declares for that decision class ([autonomy-and-decisions.md](../autonomy-and-decisions.md#decision-matrix)). A `checkpoint:decision` without `auto_select`, any `blocking-human` checkpoint, any `human-action` checkpoint and executor Rule 4 (architectural change) always go to a human. Answers are delivered with `claude -p --resume <session> "<answer>"` and recorded.
6. AVARICE adds the integrity gates GSD lacks. They reject verification overrides added during the run, treat a node-repair PRUNE as a decision, block files outside the contract's writable scope, compare test inventories, and require the skipped-test ledger to be empty or justified. The supervisor runs them after each unit in Stage 1. Stage 2 also runs them as blocking GSD gates at the points listed in [extensions.md](../extensions.md#5-gsd-capability-avarice-bridge-stage-2).
7. The unattended endpoint is `ready_for_review`: a branch in the run worktree plus an evidence package. Pushing the branch and opening a draft PR happen outside the contained invocation, by AVARICE, only when the contract authorizes them. GSD `ship` is used only in attended runs.

## Consequences

**Positive:** Routine transitions need no human. Every human question is either a real decision or a declared default with a record. GSD keeps planning, execution and its own checkpoint semantics; AVARICE adds containment, budgets and integrity gates around it.

**Negative:** AVARICE depends on GSD's text-mode output and on Claude Code's headless flags, so both version ranges must be tested on upgrade. Outcome classification from free text is a heuristic; when it cannot classify an ending, it records `inconclusive` and escalates, which costs interruptions. Within one GSD unit, an escalation stops that unit; independent work continues only across separate work items. A sleeping Mac stops the supervisor and the invocation.

**Neutral:** The attended flow from ADR-002 is unchanged.

## Alternatives considered

**Run `/gsd-autonomous` headless and answer every prompt "yes" or with the first option** - For: maximum unattended completion. Against: converts consequential decisions into guesses; exactly what `discuss --auto` does. Why not chosen: violates AUT-1 and AUT-4.

**AVARICE as the planner and executor, GSD dropped for unattended runs** - For: full control over pauses and budgets. Against: two planners, two state machines; loses GSD's checkpoint and verification work. Why not chosen: violates FR-4.

**Interactive host session kept open with a remote-control client** - For: GSD's prompts work unmodified. Against: needs a human or a bot answering in the session; no containment flags such as `--permission-prompts none`. Why not chosen: does not meet RC-4 or CON-3.

## Revisit when

- GSD ships a headless mode, a machine-readable pause signal that its workflows call, or budgets.
- Claude Code changes the meaning of `dontAsk`, `--permission-prompts` or `--max-budget-usd`.
- Outcome classification produces more than 10% `inconclusive` endings in the benchmark.

## References

- `~/.claude/gsd-core/references/checkpoints.md:11-23`
- `~/.claude/gsd-core/workflows/autonomous.md:5, 384, 413`
- `~/.claude/gsd-core/bin/lib/check-auto-mode.cjs:21-31`
- `~/.claude/gsd-core/workflows/execute-phase/steps/executor-isolation-dispatch.md:373`
- https://code.claude.com/docs/en/headless
- https://code.claude.com/docs/en/permission-modes
