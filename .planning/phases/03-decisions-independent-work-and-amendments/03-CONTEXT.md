# Phase 3: Decisions, independent work and amendments - Context

**Gathered:** 2026-11-08
**Status:** Ready for planning

<domain>
## Phase Boundary

A run may hold several work items with dependencies. When one item raises a consequential question, AVARICE writes a decision record and blocks only that item and the items that depend on it. Independent items still run to completion with evidence. `avarice decide` checks an answer and resumes the paused GSD session through `claude -p --resume`, and the run finishes. `avarice contract amend`, run from a terminal outside the run, records a new contract version and invalidates the evidence that version change affects. Notification is local only: the inbox, a macOS banner, and an opt-in launchd digest.

Requirements: AUT-1, AUT-2, AUT-3, AUT-4, AUT-5, AUT-6 (local only), AUT-10, AUT-12, AUT-16, RC-6, RC-7, RC-8, CON-15. Success criteria 1 to 6 are in `.planning/ROADMAP.md` § Phase 3.

Excluded: push notifiers, reply channels other than the terminal, parallel execution of items, delivery to a PR.

</domain>

<decisions>
## Implementation Decisions

### Exit benchmark and spend
- **D-01:** The exit runs target **`~/aa-phan-portfolio-v2` at the active pin `9f1cd8d`**, with the checks already declared in its committed `.avarice/config.json` (Phase 2 D-05, D-09, D-16). Nothing new is onboarded.
- **D-02:** A consequential question is provoked by **an ambiguity planted in the brief**. One item's acceptance criteria leave a real user-visible choice open, and another item is independent of it. If the model resolves the ambiguity silently, G1 or the integrity gates must catch it. A silent pick is an exit failure, not a pass.
- **D-03:** Pass bar: **3 runs, 3 of 3**, one `avarice start` each:
  1. **Block and resume.** An item blocks on a decision, the independent item completes with evidence, `avarice decide` answers, the paused session resumes, and the run reaches `ready_for_review` (SC1, SC3).
  2. **Stale answer.** An amendment between the question and the answer changes the state digest, and the answer is re-opened, not applied (SC3 stale path, SC4).
  3. **Silence and notifier failure, live.** The deadline passes and the banner delivery fails (forced). The decision stays open and visible in the inbox, and is then answered and finished (SC2).
  Any unexpected block or failure: diagnose, fix, and re-run all three (as Phase 2 D-08).
- **D-04:** Claude drafts the three briefs during planning, each with items, dependencies, the planted ambiguity and the expected decision count. **The owner approves or swaps them at a checkpoint before any live spend on the portfolio** (as Phase 2 D-06). The exit keeps Phase 2's order (D-07): offline fake-host and kill-point suites first, then live cases (S-17, S-18, S-21, S-50 to S-52, CS-5, CS-15) on a generated scratch repository, then the portfolio runs.
- **D-05:** **The total live-model spend ceiling for Phase 3 is 25 USD**, enforced mechanically like Phase 2 D-15: a separate Phase 3 ledger whose ceiling an environment variable can only lower. Execution stops and asks the owner before exceeding it.

### Work items in the brief
- **D-06:** A brief declares items in its frontmatter as **`items: [{id, title, dependsOn, size?, model?, acceptance: [...], spec?}]`**. Every acceptance criterion belongs to exactly one item. A brief without `items` compiles to the single item `A`, so Phase 2 briefs and their digests keep working unchanged. — **Reversibility:** costly — the brief format is user-authored input and later briefs depend on it.
- **D-07:** Spec derivation (RC-7) runs in **two stages**. Before start, fields missing from the brief are derived from the brief and the indexes (graph, intel), marked in `spec.derived`, and shown in the start summary (S-50). After GSD planning, G1 checks the plan against the item spec and the write scope. A plan that needs more than the spec allows becomes an amendment request or a decision, never a silent widening.
- **D-08:** **One `/gsd-quick` unit per item**, each with its own session ID stored in `work_items.gsd_session`. The supervisor commits after each item (Phase 2 D-03) and the required checks run (AUT-16). `--resume` targets exactly that item's session.
- **D-09:** **Items run sequentially** in dependency order in the single run clone. An item is `ready` when every item in its `dependsOn` is `done` and no open decision affects it. Blocked items and their transitive dependents are skipped. With nothing ready and a decision open, the run checkpoints and enters `blocked_on_decision` without polling (AUT-3).
- **D-10:** `modelBySize` keeps the spec map: **small→haiku, medium→sonnet, large→opus**. A per-item `model` overrides it (RC-8). The default size stays `medium` (Phase 2 D-14).
- **D-11:** Routine bounded repair (AUT-10, AUT-16): **`repairAttemptsPerCheck` = 1**. A check that newly fails after an item is charged to that item. It gets one repair invocation, then a `repeated_failure` decision carrying the smallest reproducer: failing test ID, command, output digest, and diff since the last pass. G3 enforces the limit and refuses a repair that deletes or changes the failing test without an amendment.
- **D-12:** Routine run budgets scale with the item count: **invocations = items × 2 + 1** (each item's unit plus one retry or repair, plus one resume), **cost 10.00 USD per run** (2.00 per invocation unchanged), **wall clock 120 min**. `--budget` overrides can still only lower them, and killed or orphaned invocations stay charged.

### decide and amend
- **D-13:** Syntax: **`avarice decide <decision-id> <option-key>`**, or **`avarice decide <decision-id> --text "..."`** only when the record allows free text. On a terminal, `avarice decide <decision-id>` with no answer shows the record and prompts for a choice. The interactive shell gains a **Decide** action that uses the same engine (ADR-013).
- **D-14:** Identity (AUT-5): the responder must be **the OS user who owns the profile, on an interactive terminal, not under `AVARICE_RUN` and not in the run's process tree** (the CS-11 rule that amend uses). That user is recorded as `answered_by` and the channel as `answer_channel = terminal`. A rejected response is recorded. There is no password; the threat is the agent answering itself (NG-5).
- **D-15:** The checks run in order: identity, the decision is open, the answer is a listed option (or allowed free text), duplicates (ignored after the first valid answer), then the state digest. On a digest mismatch the decision is **re-opened with refreshed evidence and the old answer kept as context**, never applied.
- **D-16:** Pickup: if no supervisor holds the run lease, **`decide` spawns the detached supervisor** through the existing single spawn path (`src/cli/spawn-supervisor.ts`). If a live supervisor is working on independent items, the answered item turns `ready` (the existing `blocked_on_decision → ready` edge) and the scheduler takes it next. There is no polling and no signals.
- **D-17:** **`decide` never widens anything.** An answer that implies more scope or budget is recorded as an amendment request. The user confirms it with `avarice contract amend`, which shows the diff; on a terminal `decide` may chain straight into that prompt. This follows the contracts doc. The autonomy doc's "applied as a contract amendment" wording goes to `findings.md`.
- **D-18:** `avarice contract amend <run>` takes **typed flags plus a required `--reason`**, for example `--budget cost=8`, `--add-write 'src/x/**'`, `--acceptance-file f.md` and `--check +lint`. It prints the field-level diff and the evidence the change would invalidate, then asks for confirmation. It needs a terminal and refuses under `AVARICE_RUN` or from the run's process tree (CS-11). Amend is reached in the shell through the existing command line, not a menu action.
- **D-19:** **An amendment may raise budgets.** It writes contract version n+1 with new budget rows; spend carries over and nothing is refunded. RC-5 still holds in the sense that the run can never raise its own limits; only the human outside the run can. The Ledger port comment that says "nothing raises a limit" is updated to say so. — **Reversibility:** costly — it changes a stated ledger invariant that docs/system and tests cite.
- **D-20:** Evidence invalidation follows the contracts doc table (acceptance → gates and acceptance mappings plus a check re-run; write or protected paths → scope conformance; checks or environment → all check evidence; policy revision → gates and approvals that cite it; budget or notify → nothing). The evidence and gate tables are insert-only by trigger, so invalidation appends `stale` rows or a version marker; it never updates rows.

### Notifications and check-ins
- **D-21:** Notification configuration lives in the **profile config**: destinations, digest times, quiet hours and the batch window. A contract may only choose a subset of the profile's destinations, never add one, so a run cannot redirect notifications. This resolves the autonomy doc vs contracts doc conflict on the autonomy doc's side; the conflict is recorded in `findings.md`.
- **D-22:** The `local` notifier **always writes the inbox and status (the source of truth) and posts a macOS banner via `osascript`** for a blocking decision and for `ready_for_review`. A banner failure is recorded as an event, retried with backoff, and leaves the decision open and visible (AUT-4, AUT-6, SC2). The notifier sits behind a Notifier port so push adapters can be added in Phase 6.
- **D-23:** Digest: **`avarice schedule install`** (opt-in) writes a user LaunchAgent with no admin rights, and **`avarice schedule remove`** deletes it. At each digest time (default **12:30 and 17:30**, set in the profile) it runs `avarice digest`, which posts one batched banner listing open decisions and review-ready runs, and nothing when there are none.
- **D-24:** Profile keys **`notify.batchWindowMinutes`** (default 10) and **`notify.quietHours`** (default off, for example `22:00-08:00`). During quiet hours banners are held for the next digest and the inbox still updates. A deadline, silence or a failed delivery never counts as approval (AUT-4).

### Documentation
- **D-25:** The phase's last plan is the documentation pass required by `CLAUDE.md` and SC6. It updates `docs/system/` documents including runs, data model, CLI reference, checks and evidence, processes and diagrams, interactive shell, config reference, integrations, containment, overview, README, coverage and findings, and gets a fresh prose review for each changed document. The proposal docs under `docs/` are not edited to match the code. The conflicts found during discussion go to `docs/system/findings.md`: notify home, amendment by reply, budget raises versus the RC-5 port comment, different `human` class lists, and S-50 spec timing.

### Claude's Discretion
- Exact frontmatter field names and validation messages for `items`, within D-06.
- Decision-class taxonomy beyond the four existing classes, the significance classifier's structural signals (AUT-1), and the record's options and consequences content.
- G1 and G3 internals, and how the five integrity gates (`no-new-overrides`, `no-test-deletion`, `no-skip-markers`, `scope-conformance`, `prune-is-decision`) attach to per-item flow.
- Whether invalidation uses appended `stale` rows or a contract-version filter, provided rows stay insert-only (D-20).
- The subagent concurrency reservation (CON-15) mechanism within the existing hook and ledger transaction pattern.
- Ticket revisions in the state digest (none exist for manual briefs; the brief digest can stand in).
- Backoff schedule for banner retries; the LaunchAgent label and plist layout.
- Cancellation of a multi-item run (AUT-12) within the existing lease and fence model.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope
- `.planning/ROADMAP.md` § Phase 3: goal, requirements, success criteria 1 to 6, notes (scheduler, `decide`, batching, local notifier, launchd digest, G1, G3, integrity gates, subagent reservation)
- `.planning/REQUIREMENTS.md`: full text of AUT-1..6, AUT-10, AUT-12, AUT-16, RC-6..8, CON-15
- `docs/implementation-plan.md` § Slice 2 (and its GSD block): deliverables, verification list (S-17, S-18, S-21, S-50..52, CS-5, CS-15, response-validation suite, amendment-invalidation tests). It has no explicit exit criterion; D-03 supplies one.
- `docs/requirements.md`: PRD (precedence PRD > ADR > SPEC > DOC)

### Decisions and autonomy
- `docs/autonomy-and-decisions.md`: decision matrix, authority classes (`delegated`, `default`, `human`, `prohibited`), handling steps, batching, notify settings, response checks, the end-to-end sequence with `claude -p --resume`
- `docs/decisions/ADR-006-unattended-delegation.md`: routed pauses, resume, integrity gates
- `docs/decisions/ADR-013-interactive-shell.md`: `decide` and `amend` in the shell

### Contract, state, gates
- `docs/contracts-and-state.md`: `modelBySize` (~:109), `decisions.defaults` (~:168), routine preset (~:198-218), amendments and invalidation table (~:220-232), budget reservation (~:234-254), Notifier port (~:508-518), state machine (~:559-632), decisions and work_items DDL (~:634-658), gates G0 to G4 (~:694-702), repair escalation (~:736)
- `docs/containment.md` (~:205-210): subagent inheritance and concurrency
- `docs/operations-and-testing.md`: CS-5, CS-11, CS-15, S-17, S-18, S-21, S-50..52, gate-weakening suite
- `docs/extensions.md` § 1: CLI and exit-code table; `avarice schedule install/remove`, `avarice digest`
- `docs/architecture.md`: digest entry point, `decisions` module

### Built system (source of truth for what exists)
- `docs/system/README.md`, `docs/system/runs.md`, `docs/system/data-model.md`, `docs/system/cli-reference.md`, `docs/system/checks-and-evidence.md`, `docs/system/config-reference.md`, `docs/system/integrations.md`, `docs/system/containment.md`, `docs/system/interactive-shell.md`, `docs/system/processes.md`
- `docs/system/findings.md`: open entries this phase resolves (decisions answered only as open, unused `blocked_on_decision → ready` edge, every failed G4 opening `repeated_failure`, prepare blocking without a record, skill naming `contract amend`), plus the owner item on proposal edits made before the documentation rule
- `docs/system/coverage.md`

### Prior phase context
- `.planning/phases/02-contained-unattended-run-of-one-work-item/02-CONTEXT.md`: D-01..D-19 (clone, supervisor commits, hand-off, checks, baseline, budgets, detach, frozen JSON)
- `.planning/STATE.md` § Decisions: Phase 2 kernel decisions (lease and fence, transitionRun, blockRun, routeOutcome order, reservation and settlement)
- `CLAUDE.md`: documentation rules and merge-to-main rules

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/adapters/sqlite/migrations/0001-initial.ts` (~:97-115): `decisions` and `work_items` tables already match the spec DDL, including `gsd_session`, `attempts`, `state_digest` and `answer_channel`. Versioned `contracts` (PK run_id and version) with `authorized_by`, `reason` and `diff_json`, plus an immutability trigger. `budgets.contract_version` exists.
- `src/ports/ledger.ts`: `storeRunContract`, `getRunContract` (highest version), `upsertWorkItem`, `transitionWorkItem` (optional `gsdSession`), `listWorkItems`, `openDecision` and `listDecisions`. Answer, stale and withdraw methods must be added.
- `src/domain/run-lifecycle.ts`: item states and edges, including the unused `blocked_on_decision → ready`. Block reasons and `RUN_NEXT_ACTIONS` need multi-item forms.
- `src/app/run-stages/blocked.ts` (`blockRun`): writes the decision record today with `options: []`, `consequences: {}` and affected item `A`. The state digest covers contract version, base revision and policy revision.
- `src/domain/gates.ts`: G2 already has `no-new-overrides`, `prune-is-decision` and `checks-delta`. G4 exists. There is no G1 or G3.
- `src/domain/run-contract.ts` (ROUTINE_PRESET ~:75-124): `defaultSize`, `modelBySize`, `repairAttemptsPerCheck: 0` (becomes 1, D-11), subagents 2 concurrent and 10 total, `notify: ['local']`, `afterEachItem: 'required-checks'`, the five integrity gates, and `decisions.defaults: []`.
- `src/cli/spawn-supervisor.ts`: the only detached spawn, which `decide` reuses (D-16).
- `src/app/run-status.ts` (`getInbox`), `src/cli/commands/inbox.ts` and `src/cli/render/run-view.ts` (`renderInbox`): list open decisions and review-ready runs.
- `src/adapters/host-claude/launch-args.ts`: `--resume` is in `VALUE_FLAGS`, not in `WIDENING_FLAGS`.

### Established Patterns
- `transitionRun` writes state, checkpoint and event in one transaction under the version and fence guard. Every new state change follows it.
- Evidence and gate rows are insert-only by trigger. Invalidation must append (D-20).
- A unit is judged from the clone, the quick records and measured facts, never the host outcome kind.
- Refusals create no row and no file. `--json` shapes stay frozen, with optional keys appended only.
- Budgets are reserved and settled in one ledger transaction, and killed or orphaned invocations stay charged.
- Live spend is guarded by a per-phase ledger with a lowering-only ceiling.

### Integration Points
- `src/app/run-stages/item.ts` (~:70) errors unless the run has exactly one item. This becomes the scheduler loop.
- `compileRunContract` (`src/domain/run-contract.ts` ~:443-451) emits a single item `A`. `src/domain/brief.ts` (~:53) parses one size and model.
- Invocation session IDs are created per invocation (`src/app/invocation.ts` ~:419) and kept only in step JSON. They must be written to `work_items.gsd_session` (D-08).
- `src/cli/main.ts` `COMMANDS`: add `decide`, `contract`, `digest`, `schedule`.
- `src/cli/shell/actions.ts`: add the Decide action.
- `src/app/run-resume.ts` (~:47) treats a blocked run as stopped. `isRunResumable` excludes `blocked_on_decision`.
- New: a Notifier port and a local adapter (osascript), and a LaunchAgent writer.

</code_context>

<specifics>
## Specific Ideas

- The exit's planted ambiguity should be a genuine user-visible choice in the portfolio (for example two valid copy or behavior options), not an artificial trap. Item A is independent of it.
- Run 3 forces the banner delivery to fail (for example an unavailable `osascript` path in the test profile) and lets a short deadline pass. It then shows the decision still open in `inbox` and `status` before answering.
- Spend accounting follows `test/containment/LIVE-CASES.md` style, with a separate Phase 3 ledger file.

</specifics>

<deferred>
## Deferred Ideas

- Parallel execution of independent items in separate clones with supervisor merge (out of scope; sequential chosen in D-09).
- Push notifiers and reply channels other than the terminal (Phase 6, per ROADMAP).
- Open items carried from STATE.md that this discussion did not settle: the Node 26.x support statement; validating `CLAUDE_CONFIG_DIR` against the `~/.claude-edu` / `~/.claude` split; backlog 999.4 and 999.5 owner decisions.

</deferred>

---

*Phase: 03-decisions-independent-work-and-amendments*
*Context gathered: 2026-11-08*
