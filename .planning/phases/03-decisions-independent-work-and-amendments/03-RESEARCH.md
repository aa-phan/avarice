# Phase 3: Decisions, independent work and amendments - Research

**Researched:** 2026-11-08
**Domain:** Unattended multi-item run supervision on an existing TypeScript/Node 26, zero-dependency, SQLite-backed, contained-host (Claude Code) kernel: work-item scheduler, decision records and answers, `claude -p --resume`, contract amendment with evidence invalidation, local notification, launchd digest.
**Confidence:** HIGH on what exists in the code and what must change; MEDIUM on live-model behaviour (pause, resume, plan format), which no offline test can prove and which Wave 0 must spike.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Exit benchmark and spend
- **D-01:** The exit runs target **`~/aa-phan-portfolio-v2` at the active pin `9f1cd8d`**, with the checks already declared in its committed `.avarice/config.json` (Phase 2 D-05, D-09, D-16). Nothing new is onboarded.
- **D-02:** A consequential question is provoked by **an ambiguity planted in the brief**. One item's acceptance criteria leave a real user-visible choice open, and another item is independent of it. If the model resolves the ambiguity silently, G1 or the integrity gates must catch it. A silent pick is an exit failure, not a pass.
- **D-03:** Pass bar: **3 runs, 3 of 3**, one `avarice start` each:
  1. **Block and resume.** An item blocks on a decision, the independent item completes with evidence, `avarice decide` answers, the paused session resumes, and the run reaches `ready_for_review` (SC1, SC3).
  2. **Stale answer.** An amendment between the question and the answer changes the state digest, and the answer is re-opened, not applied (SC3 stale path, SC4).
  3. **Silence and notifier failure, live.** The deadline passes and the banner delivery fails (forced). The decision stays open and visible in the inbox, and is then answered and finished (SC2).
  Any unexpected block or failure: diagnose, fix, and re-run all three (as Phase 2 D-08).
- **D-04:** Claude drafts the three briefs during planning, each with items, dependencies, the planted ambiguity and the expected decision count. **The owner approves or swaps them at a checkpoint before any live spend on the portfolio** (as Phase 2 D-06). The exit keeps Phase 2's order (D-07): offline fake-host and kill-point suites first, then live cases (S-17, S-18, S-21, S-50 to S-52, CS-5, CS-15) on a generated scratch repository, then the portfolio runs.
- **D-05:** **The total live-model spend ceiling for Phase 3 is 25 USD**, enforced mechanically like Phase 2 D-15: a separate Phase 3 ledger whose ceiling an environment variable can only lower. Execution stops and asks the owner before exceeding it.

#### Work items in the brief
- **D-06:** A brief declares items in its frontmatter as **`items: [{id, title, dependsOn, size?, model?, acceptance: [...], spec?}]`**. Every acceptance criterion belongs to exactly one item. A brief without `items` compiles to the single item `A`, so Phase 2 briefs and their digests keep working unchanged. — **Reversibility:** costly — the brief format is user-authored input and later briefs depend on it.
- **D-07:** Spec derivation (RC-7) runs in **two stages**. Before start, fields missing from the brief are derived from the brief and the indexes (graph, intel), marked in `spec.derived`, and shown in the start summary (S-50). After GSD planning, G1 checks the plan against the item spec and the write scope. A plan that needs more than the spec allows becomes an amendment request or a decision, never a silent widening.
- **D-08:** **One `/gsd-quick` unit per item**, each with its own session ID stored in `work_items.gsd_session`. The supervisor commits after each item (Phase 2 D-03) and the required checks run (AUT-16). `--resume` targets exactly that item's session.
- **D-09:** **Items run sequentially** in dependency order in the single run clone. An item is `ready` when every item in its `dependsOn` is `done` and no open decision affects it. Blocked items and their transitive dependents are skipped. With nothing ready and a decision open, the run checkpoints and enters `blocked_on_decision` without polling (AUT-3).
- **D-10:** `modelBySize` keeps the spec map: **small→haiku, medium→sonnet, large→opus**. A per-item `model` overrides it (RC-8). The default size stays `medium` (Phase 2 D-14).
- **D-11:** Routine bounded repair (AUT-10, AUT-16): **`repairAttemptsPerCheck` = 1**. A check that newly fails after an item is charged to that item. It gets one repair invocation, then a `repeated_failure` decision carrying the smallest reproducer: failing test ID, command, output digest, and diff since the last pass. G3 enforces the limit and refuses a repair that deletes or changes the failing test without an amendment.
- **D-12:** Routine run budgets scale with the item count: **invocations = items × 2 + 1** (each item's unit plus one retry or repair, plus one resume), **cost 10.00 USD per run** (2.00 per invocation unchanged), **wall clock 120 min**. `--budget` overrides can still only lower them, and killed or orphaned invocations stay charged.

#### decide and amend
- **D-13:** Syntax: **`avarice decide <decision-id> <option-key>`**, or **`avarice decide <decision-id> --text "..."`** only when the record allows free text. On a terminal, `avarice decide <decision-id>` with no answer shows the record and prompts for a choice. The interactive shell gains a **Decide** action that uses the same engine (ADR-013).
- **D-14:** Identity (AUT-5): the responder must be **the OS user who owns the profile, on an interactive terminal, not under `AVARICE_RUN` and not in the run's process tree** (the CS-11 rule that amend uses). That user is recorded as `answered_by` and the channel as `answer_channel = terminal`. A rejected response is recorded. There is no password; the threat is the agent answering itself (NG-5).
- **D-15:** The checks run in order: identity, the decision is open, the answer is a listed option (or allowed free text), duplicates (ignored after the first valid answer), then the state digest. On a digest mismatch the decision is **re-opened with refreshed evidence and the old answer kept as context**, never applied.
- **D-16:** Pickup: if no supervisor holds the run lease, **`decide` spawns the detached supervisor** through the existing single spawn path (`src/cli/spawn-supervisor.ts`). If a live supervisor is working on independent items, the answered item turns `ready` (the existing `blocked_on_decision → ready` edge) and the scheduler takes it next. There is no polling and no signals.
- **D-17:** **`decide` never widens anything.** An answer that implies more scope or budget is recorded as an amendment request. The user confirms it with `avarice contract amend`, which shows the diff; on a terminal `decide` may chain straight into that prompt. This follows the contracts doc. The autonomy doc's "applied as a contract amendment" wording goes to `findings.md`.
- **D-18:** `avarice contract amend <run>` takes **typed flags plus a required `--reason`**, for example `--budget cost=8`, `--add-write 'src/x/**'`, `--acceptance-file f.md` and `--check +lint`. It prints the field-level diff and the evidence the change would invalidate, then asks for confirmation. It needs a terminal and refuses under `AVARICE_RUN` or from the run's process tree (CS-11). Amend is reached in the shell through the existing command line, not a menu action.
- **D-19:** **An amendment may raise budgets.** It writes contract version n+1 with new budget rows; spend carries over and nothing is refunded. RC-5 still holds in the sense that the run can never raise its own limits; only the human outside the run can. The Ledger port comment that says "nothing raises a limit" is updated to say so. — **Reversibility:** costly — it changes a stated ledger invariant that docs/system and tests cite.
- **D-20:** Evidence invalidation follows the contracts doc table (acceptance → gates and acceptance mappings plus a check re-run; write or protected paths → scope conformance; checks or environment → all check evidence; policy revision → gates and approvals that cite it; budget or notify → nothing). The evidence and gate tables are insert-only by trigger, so invalidation appends `stale` rows or a version marker; it never updates rows.

#### Notifications and check-ins
- **D-21:** Notification configuration lives in the **profile config**: destinations, digest times, quiet hours and the batch window. A contract may only choose a subset of the profile's destinations, never add one, so a run cannot redirect notifications. This resolves the autonomy doc vs contracts doc conflict on the autonomy doc's side; the conflict is recorded in `findings.md`.
- **D-22:** The `local` notifier **always writes the inbox and status (the source of truth) and posts a macOS banner via `osascript`** for a blocking decision and for `ready_for_review`. A banner failure is recorded as an event, retried with backoff, and leaves the decision open and visible (AUT-4, AUT-6, SC2). The notifier sits behind a Notifier port so push adapters can be added in Phase 6.
- **D-23:** Digest: **`avarice schedule install`** (opt-in) writes a user LaunchAgent with no admin rights, and **`avarice schedule remove`** deletes it. At each digest time (default **12:30 and 17:30**, set in the profile) it runs `avarice digest`, which posts one batched banner listing open decisions and review-ready runs, and nothing when there are none.
- **D-24:** Profile keys **`notify.batchWindowMinutes`** (default 10) and **`notify.quietHours`** (default off, for example `22:00-08:00`). During quiet hours banners are held for the next digest and the inbox still updates. A deadline, silence or a failed delivery never counts as approval (AUT-4).

#### Documentation
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

### Deferred Ideas (OUT OF SCOPE)
- Parallel execution of independent items in separate clones with supervisor merge (out of scope; sequential chosen in D-09).
- Push notifiers and reply channels other than the terminal (Phase 6, per ROADMAP).
- Open items carried from STATE.md that this discussion did not settle: the Node 26.x support statement; validating `CLAUDE_CONFIG_DIR` against the `~/.claude-edu` / `~/.claude` split; backlog 999.4 and 999.5 owner decisions.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUT-1 | Human involvement by decision significance, never stage end or model confidence | Pure `classifyDecision` over structural signals (see Architecture Pattern 3); the unit prompt must state the `human` classes (today it does not) |
| AUT-2 | Decision record: issue, evidence, options, recommendation, consequences, affected dependencies, authorized default | `blockRun` writes `options: []`, `consequences: {}`, one affected item today; needs options parsed from the pause, transitive affected items, and a recommendation field (Pattern 3) |
| AUT-3 | Independent authorized work continues; dependents not implemented; none left -> visible blocked state without polling | Scheduler loop in the `running` stage (Pattern 1); park/unpark of the paused item's working-tree delta (Pitfall 1) |
| AUT-4 | Deadlines, silence and notifier failure never count as approval | No timer ever writes `answered`; notifier failure is an event plus a `notifications` row; S-18 on a simulated clock |
| AUT-5 | Response validated for identity, scope, applicability, duplication; refs refreshed before resuming | `decide` check order of D-15 in one ledger transaction; shared `computeStateDigest` (Pattern 4) |
| AUT-6 | Local notification only; failed delivery leaves decision pending and visible; software scheduling | Notifier port + `osascript` adapter with argv-passed text (verified injection-safe) + launchd LaunchAgent writer |
| AUT-10 | Repair loops bounded, escalate with smallest reproducer | `repairAttemptsPerCheck` 1, item edge `implemented -> delegated` for the repair, reproducer record (Pattern 6) |
| AUT-12 | Every state visible offline; cancellation and resumption safe at any point | No cancel command exists today; recommend `avarice cancel <run>` (Open Question 4) and a multi-item reconcile |
| AUT-16 | Required checks after every item; newly failing check charged to that item, repair, then decision | The checks already run in G2 per item against the baseline delta; Phase 3 adds the repair step and G3 |
| RC-6 | Amendment = new contract version with authorizer, reason, diff; evidence invalidated by type | `storeRunContract` already writes versions and `contracts.diff_json`; add the amend service, the budget-limit UPDATE and invalidation (Pattern 5) |
| RC-7 | Item size and spec; derived fields recorded | `RunWorkItem.spec.derived` exists; two-stage derivation (D-07), G1 for the post-plan stage |
| RC-8 | Model per item from size via `modelBySize`, per-item override | Already: `model: item.model` in `prepareRunInvocation`; Phase 3 compiles N items and records the model on the invocation event (S-51) |
| CON-15 | Subagents equal or narrower authority, parent's budget | Already enforced for one item (hook charges the run-wide row; concurrency counted per invocation); Phase 3 adds multi-item budget scaling and run-purpose live cases CS-5 and CS-15 |
</phase_requirements>

## Summary

Phase 3 changes a kernel whose every stage assumes one work item named `A`. The assumption is in: the item stage (`loadUnit` errors unless the run has exactly one item), `blockRun` (defaults `itemId` to `'A'`), the verify stage (`const itemId = 'A'`), the baseline and the resume prelude (`items.value[0]`, evidence `workItem: 'A'`), `startRun` (stores only `workItems[0]`), the attempt reasons (`'initial'` then `'con16-retry'`) and `latestAttempt` (the run's last attempt stands for the item's). The surfaces Phase 3 needs mostly already exist as unused parts: decision and work-item tables, versioned contracts with `authorized_by`, `reason` and `diff_json`, the `stale` evidence status, the `answered/stale/withdrawn` decision states, the `blocked_on_decision -> ready` item edge, and the `blocked_on_decision -> running` run edge. Almost no schema work is needed; a migration 0003 is recommended only for notification state and `attempts.item_id`.

Three risks decide whether the phase passes its live exit, and none can be settled offline. (1) **The live pause path is not wired.** The Claude host parser drops the result text, so the host outcome never carries a `question`; `docs/system/findings.md` records the numbered-choice pause as reachable only from a host that reports final text, and three attended sessions made the edit instead of asking. The exit's planted ambiguity (D-02) only works if the final-text tail is captured and the unit prompt tells the model which decisions it must stop for. (2) **A paused item leaves its working-tree delta and its quick records in the single clone while independent items run**, and `commitUnit` removes every artifact path in the clone, which would delete the paused item's PLAN. The delta must be parked and restored (Pitfall 1). (3) **`claude -p --resume` is not wired and not live-verified**: the launch builder always emits `--session-id`, which the CLI refuses together with `--resume`, and the reap matches only `--session-id <uuid>`. The installed `claude` is 2.1.319, which is not in `ADMITTED_CLAUDE_VERSIONS`, so every live run is refused until that version is admitted or the 2.1.318 binary is pinned.

The decision-answer path has one concurrency hole worth designing for up front: a lost wakeup between a supervisor deciding "nothing ready, block" and a `decide` that answers at the same moment. The protocol "block, release the lease, re-check for ready items, re-acquire if any" closes it (Pitfall 3). All other new behaviour follows patterns the kernel already uses: one transaction per state change under the lease fence, checkpoint before side effect, refusals create no row, `--json` shapes only gain optional keys, evidence and gate rows insert-only.

**Primary recommendation:** Build bottom-up in this order: Wave 0 (Phase 3 spend ledger, host admission, live spike S3-A for pause and resume, migration 0003), then pure domain (brief items, scheduler, classifier, G1, G3, digest, invalidation), then the multi-item stage loop with park/unpark and the block/release/re-check protocol, then `decide`, `contract amend`, notifier, digest and schedule, then offline suites, live scratch cases, owner-approved briefs, the three portfolio runs, and the documentation plan last.

## Project Constraints (from CLAUDE.md)

- Documentation: `docs/system/` is the source of truth for built behaviour; any change that alters behaviour, adds a command, flag, config key, table, event or integration, or changes an exit code updates the matching `docs/system/` document in the same change. A new subsystem gets its own document, written from the code, listed in `docs/system/README.md` (documents table and proposal counterparts table) and `docs/system/coverage.md`. `[CITED: CLAUDE.md "Documentation"]`
- `docs/` outside `docs/system/` is the proposal: do not edit it to match the code; when code and a proposal disagree, add one line with `file:line` to `docs/system/findings.md`. `[CITED: CLAUDE.md]`
- Every phase ends with a documentation plan, the phase's last plan, depending on all others: compares the diff with `docs/system/`, updates README tables, `coverage.md`, `findings.md`, and has each new or changed document reviewed by a fresh `technical-writer:prose-reviewer` before `coverage.md` marks it reviewed. Load `technical-writer:technical-writing` for documentation prose; `docs/system/` documents name modules once in the opening and keep file paths, function names and delivery history (phase numbers, plan IDs, threat IDs) out of the prose. `[CITED: CLAUDE.md]`
- Merge: work reaches `main` only through a pull request merged with a merge commit (`gh pr merge --merge`); no squash, rebase, fast-forward, direct push or local merge; delete the branch afterwards. `[CITED: CLAUDE.md "Merging into main"]`
- Memory: one phase branch through discuss, plan, execute; no PR for context or plans alone. `[CITED: MEMORY.md]`
- Code conventions observed in the repo (not in CLAUDE.md, but every Phase 2 plan followed them): `src/domain` imports only domain files plus `node:crypto` and touches no `process`; `src/app` never imports adapters or cli; `node scripts/check-boundaries.ts` must stay green; Node built-ins only (no runtime dependency, `test/unit/footprint.test.ts` pins this and exactly one detached spawn); `--json` shapes frozen, optional keys appended last. `[CITED: scripts/check-boundaries.ts header comment; test/unit/footprint.test.ts; STATE.md 02-02 decision]`

## Architectural Responsibility Map

AVARICE is a local CLI plus a detached supervisor plus a contained host; the tiers below are its own.

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Item graph, `ready` computation, scheduling order | Domain (pure) | App (stage loop applies it) | Pure function over item rows and decision rows; testable without I/O |
| Decision significance and authority class | Domain (pure) | App (builds the record) | Structural signals only (AUT-1); no model confidence input |
| Decision record write, answer, stale, withdraw | Ledger (one transaction each) | App (validation order) | State change, event and item edge must commit together or not at all |
| Responder identity (TTY, `AVARICE_RUN`, process ancestry, profile owner) | CLI command module + a small process adapter | App (the check order) | Reads `process`, `ps`; the domain may not |
| Park and unpark of a paused item's delta | RunWorkspace adapter (git) | App (stage decides when) | The adapter is the only code that touches git for a run |
| `claude -p --resume`, final-text capture, reap by `--resume` | Host adapter (host-claude) | App (chooses resume vs fresh unit) | Vendor flags stay in the adapter; the port gains a vendor-neutral `resume` field |
| Local banner, retry/backoff state | Notifier port + `osascript` adapter | App (batching, quiet hours policy; pure) | Port keeps push adapters for Phase 6 |
| Digest schedule (LaunchAgent) | Adapter (plist writer, `launchctl`) | CLI (`schedule install/remove`, `digest`) | OS-registered state, outside any run |
| Contract amendment (version n+1, diff, invalidation) | App service over Ledger | Domain (diff and classification, pure) | The one place that may raise a limit; refuses under `AVARICE_RUN` |
| Gates G1 and G3 | Domain (pure verdicts) | App (collects facts) | Same shape as `evaluateG2`/`evaluateG4` |
| Cancel | CLI + App service (lease-fenced) | Supervisor (abort signal) | Reuses the lease and the abort controller |

## Standard Stack

### Core

No external package is added. The footprint test fails on any runtime dependency and the repository pins devDependencies exactly. `[VERIFIED: package.json:18-21 "@types/node": "22.20.5", "typescript": "7.0.2"]` `[CITED: test/unit/footprint.test.ts]`

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-ins (`node:sqlite`, `node:child_process`, `node:fs`, `node:test`, `node:crypto`) | 26.9.0 on this machine; engines `>=22.22.3` | Everything, as in Phases 1-2 | Project rule: zero runtime dependencies `[VERIFIED: package.json:6-8 "node": ">=22.22.3"; ran node --version]` |
| TypeScript | 7.0.2 (`tsc -p .`) | Type check; Node strips types at run time | Already the build gate; `npm run typecheck` ran green in 0.4 s here `[VERIFIED: package.json:16 "typecheck": "tsc -p ." and :20 "typescript": "7.0.2"; ran]` |
| `/usr/bin/osascript` | macOS system | Banner | Locked by D-22 |
| `launchctl` (`bootstrap`, `bootout`, `print`) and `plutil -lint` | macOS system | LaunchAgent install, remove, validation | `launchctl help` lists `bootstrap`, `bootout`, `print`; `load`/`unload` are labelled "Recommended alternatives" `[VERIFIED: ran launchctl help]` |

### Supporting
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| `/bin/ps -o ppid=,command=` | macOS system | Process-ancestry check for the CS-11 rule | In the identity check; the claude host adapter already shells `/bin/ps -o pgid=` `[CITED: docs/system/integrations.md "Reaping by session ID"]` |
| Existing test helpers: `FakeRunHost`, `run-fixtures`, `fault-run`, `pty-drive.py` | in repo | Offline suites, kill points, shell key tests | Extend, do not replace (see Wave 0 Gaps) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| JSON-valued `items:` frontmatter line | A YAML parser | Forbidden: no runtime dependency. Use strict `JSON.parse` of the value, with indented continuation lines allowed (Pitfall 9) |
| `launchctl load` | `launchctl bootstrap gui/<uid>` | `load` is legacy; `bootstrap` is the documented replacement `[VERIFIED: launchctl help]` |
| Structured pause via `gsd_run state signal-waiting` (writes `.planning/WAITING.json`) | Final-text numbered list | `signal-waiting` exists but no workflow calls it and the hook admits only three read verbs; admitting it needs a hook verb change and WAITING.json is not an artifact path (G2 scope breach). Final-text capture needs only the parser change `[CITED: ~/.claude/gsd-core/bin/gsd-tools.cjs:18, bin/lib/state.cjs:5219; docs/existing-tooling-assessment.md:141]` |

**Installation:** none.

**Version verification:** No package is installed, so no registry check applies. Host CLI: `claude --version` -> `2.1.319 (Claude Code)`; `ADMITTED_CLAUDE_VERSIONS` is `['2.1.312', '2.1.316', '2.1.317', '2.1.318']` `[VERIFIED: ran claude --version; src/adapters/host-claude/launch-preflight.ts:22]`.

## Package Legitimacy Audit

No external package is installed or recommended in this phase. Audit not applicable.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none) | - | - | - | - | - | - |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
 avarice start --brief b.md          avarice decide <id> <opt>         avarice contract amend <run> --reason ...
        |                                    |  (TTY, not AVARICE_RUN,                |  (same terminal rules, CS-11)
        v                                    |   not in run process tree)             v
  parseBrief (items JSON)                    v                                  diff + invalidation preview
        v                           [identity] -> [open?] -> [listed option?]         |  confirm
  compile N items + budgets                  -> [duplicate?] -> [state digest ==?]    v
        v                                    |        | mismatch                storeRunContract v(n+1)
  createRunWithContract                      |        v                         + raise budget limits (UPDATE)
        |                                    |   old -> stale, NEW decision      + append `stale` evidence rows
        v                                    |   opened (old answer = context)   + events
  spawn detached supervisor <---- spawn if no live lease                              |
        |                                    v answered: item blocked -> ready        |
        v                          run blocked? -> supervisor continues <-------------+ (digest of open decisions now stale)
 +--------------------------- supervisor (lease + fence) ------------------------------+
 | prelude: reap, charge orphans, reconcile (per in-flight item)                       |
 | LOOP: ready = items(dependsOn all done, no open decision affects it)                |
 |   ready item?                                                                        |
 |    yes -> [resume item w/ answer]  or  [fresh unit]                                  |
 |           launch (model = item.model) -> classify                                    |
 |            paused -> park delta -> decision record -> item blocked ----+             |
 |            progressed -> G1 (plan) -> G2 (+ required checks vs baseline)              |
 |                 check newly failing? -> repair unit (1) -> G3 -> else decision        |
 |                 pass -> commit (supervisor) -> item done -> run running->running      |
 |    no  -> all done? -> verifying (G4 on final commit) -> ready_for_review -> notify  |
 |         -> open decision? -> blocked_on_decision, RELEASE lease, RE-CHECK ready,      |
 |            (re-acquire if any) else exit; notify (banner, retry/backoff, inbox)       |
 +---------------------------------------------------------------------------------------+
        notifier: inbox/status always (ledger is the truth) + osascript banner (argv)
        digest:   launchd agent -> `avarice digest` -> one batched banner (none if empty)
```

### Recommended Project Structure
```
src/
├── domain/
│   ├── work-items.ts        # item graph: validate DAG, readyItems(), transitive dependents (pure)
│   ├── decision-policy.ts   # classifyDecision(signals, contract), buildDecisionRecord, parse numbered options
│   ├── state-digest.ts      # computeStateDigest(contract) shared by blockRun and decide
│   ├── response-validation.ts # D-15 check order as a pure function over facts
│   ├── gate-g1.ts / gate-g3.ts (or extend gates.ts) # evaluateG1, evaluateG3 (pure)
│   ├── amendment.ts         # field diff, invalidation classification (pure)
│   ├── notify-policy.ts     # batching window, quiet hours, backoff schedule (pure)
│   └── brief.ts, run-contract.ts, run-lifecycle.ts  # extended
├── ports/  notifier.ts      # Notifier port (+ ledger methods for answer/stale/withdraw/amend/notifications)
├── app/
│   ├── run-stages/{item.ts (scheduler loop), park.ts, repair.ts, blocked.ts, finish.ts}
│   ├── decide.ts  amend.ts  cancel.ts  notify.ts  digest.ts
├── adapters/
│   ├── notify/local-notifier.ts        # osascript, argv-only
│   ├── schedule/launchd.ts             # plist writer + launchctl
│   ├── proc/ancestry.ts                # ps walk
│   ├── git/run-workspace.ts            # + park/unpark (tree delta)
│   ├── host-claude/{launch-args,claude-host,stream-json}.ts # resume, final text, reap by --resume
│   └── sqlite/migrations/0003-decisions.ts
└── cli/commands/{decide,contract,digest,schedule,cancel}.ts  + shell/actions.ts (Decide)
```

### Pattern 1: Scheduler as a pure function plus a stage loop
**What:** `readyItems(items, decisions)` returns items whose state is `ready`, whose `dependsOn` are all `done`, and which no open decision lists in `affectedItems`; transitive dependents of a blocked item are skipped by the same rule. The `running` stage picks the first ready item in declaration order, runs it through the existing attempt path, then performs a `running -> running` transition (an edge the table already has) so the supervisor loop sees progress.
**When to use:** every pass of the `running` stage.
**Example (shape):**
```typescript
// src/domain/work-items.ts (pure) -- a sketch, not final code
export function readyItems(items: readonly ItemFacts[], openAffected: ReadonlySet<string>): ItemFacts[] {
  const done = new Set(items.filter((i) => i.state === 'done').map((i) => i.itemId));
  return items.filter((i) => i.state === 'ready' && !openAffected.has(i.itemId) && i.dependsOn.every((d) => done.has(d)));
}
```
Source: the supervisor loop treats a stage that returns without changing run state and version as an error (`the ${row.state} stage made no progress`), so each completed item must transition the run `[CITED: src/app/run-service.ts, the `A stage that returns without moving the run would loop forever.` block]`; the `running -> running` edge is in `DIAGRAM_EDGES` `[CITED: src/domain/run-lifecycle.ts, read via shell; the docs state it as "running --> running: work item gate passed, next ready item started" in docs/contracts-and-state.md]`. Because `blockRun` marks only the named item, `openAffected` must include the **transitive dependents** of the decision's `affectedItems` (compute them when the decision is opened and store them in `affected_items_json`, so "not implement dependent work" is a stored fact, not a recomputation).

### Pattern 2: Block, release, re-check (no lost wakeup)
**What:** When nothing is ready and a decision is open, the supervisor (a) transitions the run to `blocked_on_decision`, (b) explicitly releases the lease, (c) re-reads the items, and (d) if any item is `ready` (a `decide` answered in the window), re-acquires the lease, transitions `blocked_on_decision -> running` and continues. `decide` answers in one ledger transaction (decision `answered`, item `blocked_on_decision -> ready`) and then reads the run: if it is `blocked_on_decision` with no live lease, it spawns the supervisor; if the lease is live it does nothing.
**Why it closes the race:** order of events on the ledger is total. Either the answer committed before the re-check (the supervisor sees a ready item), or `decide`'s post-answer read happens after the release (no live lease, so it spawns), or it read a live lease and the re-check, which follows the release, which follows that read, sees the answer.
**Source:** `runSupervisor` returns at once for any stop state without taking a lease (`if (isRunStopState(first.value.state)) return ok(outcomeOf(first.value, null));`), and `acquireRunLease` is a single conditional UPDATE (`WHERE ... AND (lease_holder IS NULL OR lease_expires_at < ?)`) `[CITED: src/app/run-service.ts and src/adapters/sqlite/ledger.ts acquireLeaseOn, read via shell]`. The supervisor therefore needs a "continuable blocked run" rule: `blocked_on_decision` with reason `decision` and at least one item `ready` or one answered, unconsumed decision.

### Pattern 3: Decision record builder and classifier
**What:** One pure `classifyDecision` maps structural signals to `{ class, authority, urgency, options, affectedItems }`. Recommended table (taxonomy beyond the four existing classes is discretionary; the ledger already accepts eight classes `acceptance, architecture, scope_expansion, permission, repeated_failure, equivalent_mutant, contradiction, budget` `[VERIFIED: src/adapters/sqlite/ledger.ts:102]`, and `RunDecisionClass` in `blocked.ts` uses four of them):

| Signal (measured, never model confidence) | Class | Authority | Options |
|---|---|---|---|
| Pause: numbered-choice final text, `WAITING.json`, VERIFICATION `human_needed` | `acceptance` (or `architecture` if the question names a dependency or API) | `human` | parsed from the numbered list as `{key:'1', label}`; free text allowed when none parse |
| G1: plan has a `checkpoint:decision` with no `auto_select` that the unit then resolved | `acceptance` | `human` | the plan's `<option id>` values |
| G1: plan path outside item spec or write scope | `scope_expansion` | `human` | `amend` (records an amendment request) / `skip item` |
| G2 `scope-conformance`, hook breach, host refusal | `permission` | `prohibited` | none: answer only by amending or cancelling |
| `budget_exhausted` | `budget` | `prohibited` | none: answer is `avarice contract amend --budget ...` |
| Repair exhausted (G3 or G2 `checks-delta` after repair) | `repeated_failure` | `human` | reproducer in `evidence_refs`; options `abandon item` / `retry once more` only via amendment |
| `checkpoint:decision` with a declared `auto_select` | n/a | `default` | none; record as an assumption, no decision row |
| Matches `contract.decisions.delegated` | n/a | `delegated` | none; recorded in the run's assumption log |

**Unclassifiable pause is consequential:** `docs/autonomy-and-decisions.md` states a GSD pause the supervisor cannot classify "is treated as consequential" `[CITED: docs/autonomy-and-decisions.md "Decision matrix"]`.
**The unit prompt must name the human classes.** `contractText` in `run-gsd-config.ts` lists title, behavior, acceptance, exclusions, write paths, records and commands, but not `decisions.human` or `delegated` `[VERIFIED: src/app/run-gsd-config.ts, read this session via shell]`. Add a sentence (as `RUN_WORKFLOW_SENTENCE` was added after spike S2-B round 1) telling the model to stop and ask, as a question followed by `1.`, `2.` choices, when a choice changes user-visible behavior, an acceptance criterion, a dependency or a public API, and not to decide those itself.

### Pattern 4: One state digest, computed in one place
`blockRun` computes `digestOf({ contractVersion, baseRevision, policyRevision })` inline `[CITED: src/app/run-stages/blocked.ts, the `stateDigest:` line after `affectedItems: [itemId],` at line 73]`, and writes `options: [],` and `consequences: {},` `[VERIFIED: src/app/run-stages/blocked.ts:70-71]`. Move this to a pure `computeStateDigest(contract, version)` used by `blockRun`, `decide` and the stale re-open, and add the brief digest (`requirementRefs[0].revision`) as the stand-in for ticket revisions (discretion item). In Phase 3 only the contract version and policy revision can differ in practice: the run clone is pinned, so a moving source branch changes nothing.

### Pattern 5: Amendment as a service over existing ledger methods
`storeRunContract(runId, {fence}, input)` already writes any version with `authorizedBy`, but it requires a lease fence and has no production caller `[CITED: src/adapters/sqlite/ledger.ts storeRunContract; findings.md "storeRunContract has no production caller"]`. The amend command is not a lease holder. Two options: (a) the command acquires the run lease (free or expired) for the duration of the write, refusing with exit 3 when a live supervisor holds it, or (b) a new ledger method `amendRunContract` that checks only the contract version (optimistic) and the run state, in one transaction. Recommend (b): amend must work while a supervisor is busy with an independent item, and an optimistic version check (`expected = current version`) is enough. The transaction does: insert contract n+1 (body, digest, `authorized_by`, `reason`, `diff_json`), UPDATE `limit_value` and `contract_version` for changed budget rows (the `budgets` primary key is `(run_id, name)`, so D-19's "new budget rows" can only be a limit UPDATE; there is no trigger on `budgets`), append `stale` evidence rows per the table, append events. `contractVersion: 1;` in `RunContract` is a literal type today and must become `number` `[CITED: src/domain/run-contract.ts:136-138, the `RunContract` interface, `schema: 1;` then `contractVersion: 1;`]`.

**Invalidation (discretion item): recommend the hybrid.** Store the classification in `contracts.diff_json` (`invalidates: ['acceptance','scope',...]`), and append `stale` evidence rows (status `stale` already exists `[VERIFIED: src/adapters/sqlite/ledger.ts:100]`) for the affected check evidence so `status` shows them. Rely on G4's own re-proof as the backstop: the verify stage re-runs every required check at the final commit under the then-current contract version and evaluates only evidence at the final revision. Gate rows: append a failed `G2`/`G4` row with rule `stale-after-amendment` only if `status` must stop showing the old pass; otherwise skip (`latestGates` shows the last row per gate, so an appended failed row changes what `status` prints).

### Pattern 6: Repair as a second delegation of the same item
The item lifecycle has no edge `implemented -> delegated` `[VERIFIED: src/domain/run-lifecycle.ts:145-154]`. Add it (named repair), guarded by `repairAttemptsPerCheck` and the invocation budget. A failing G2 whose only failures are `checks-delta` (and, for the same reason, a failing item-level required check) opens a repair attempt (reason `repair`) with the reproducer as input; the item's uncommitted delta stays in the clone. Gate and commit for that item must use the **item's** base snapshot, not the repair attempt's: `changedSince(repairSnapshot)` would show only the repair's diff and the commit would omit the first unit's work (Pitfall 5). G3 runs after the repair's classify and before G2 re-evaluation.

### Anti-Patterns to Avoid
- **Reading `items[0]` or `latestAttempt` as "the item".** Every such site (list in Summary) must take an explicit item ID, and `attempts` needs an item key (migration 0003 `attempts.item_id`, or derive from `launch:run` steps; the column is simpler and indexable).
- **Interpolating model or decision text into AppleScript.** Verified: passing text as `osascript` argv and reading `item 1 of argv` keeps an injected `" & (do shell script ...) & "` inert (ran it: it printed the literal text). Never build the `-e` script from decision text.
- **A timer, `setTimeout` or any "deadline" code path that writes `answered`.** Deadlines only change what is notified (AUT-4).
- **Mutating evidence or gate rows.** Triggers refuse UPDATE and DELETE (`'evidence is insert-only'`, `'gate_results is insert-only'`) `[CITED: src/adapters/sqlite/migrations/0002-run.ts, read via shell]`.
- **Letting `decide` change the contract.** D-17: record an amendment request (a decision-linked note); only `amend` writes a version.
- **Putting `process`, `ps` or `osascript` calls in `src/domain` or `src/app`.** The boundary lint fails; use adapters and a port.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| State change atomicity | New locking or file flags | `tx(db, ...)` ledger transactions and the lease fence | One mechanism everywhere; kill-point tests already target it |
| Detaching the supervisor | A second `spawn` | `spawnSupervisor` in `src/cli/spawn-supervisor.ts` | The footprint test allows exactly one detached spawn and fixes its arguments; add `decide.ts` to the importer allow-list in that test |
| Process reaping | New `kill` logic | `reapBySessionId` (extend its pattern to `--resume <uuid>`) | Group-leader and grace rules are tested |
| Budget reservation | New counters | `reserveRunInvocation`/`settleInvocation` and the hook's charge on the same rows | CON-13/CON-15 already hold across invocations |
| Hash-chained event log | Own log file for notifications | `appendEvent` (strings limited to 1024 characters, data to 8192) | Events carry IDs and counts only |
| Brief frontmatter parsing | A YAML or TOML parser | Strict `JSON.parse` of one value (after joining indented continuation lines) | No dependency allowed |
| Plist text | String concatenation of user text | A fixed template with only a fixed label, fixed program arguments and integer Hour/Minute values; validate with `plutil -lint` | Digest times come from the profile config; reject anything that is not `HH:MM` digits |
| Test-ID extraction from a failing check | A generic parser | Best-effort extractors for the runners the repository uses (vitest `FAIL path > name`, node:test), recorded as optional `failingTests`; the reproducer is valid without it | Output formats vary; never block on parse failure |
| Glob containment for `--add-write` | A new matcher | `globWithin`/`withinAny` in `run-contract.ts` | The compile-time narrowing rule is the proven one |

**Key insight:** every hard part of this phase (atomic state, containment, budgets, detach, reap, glob rules, insert-only evidence) already has a tested mechanism; the work is wiring N items through them and closing the concurrency and working-tree gaps, not inventing new machinery.

## Common Pitfalls

### Pitfall 1: The paused item's working tree and quick records are destroyed or contaminate the next item
**What goes wrong:** Item B pauses mid-unit; item C then runs in the same clone. (a) B's uncommitted source edits sit in the tree, so C's required checks and inventory run on B's half-finished code. (b) `commitUnit` takes **every** artifact path out of the clone (`workspace.status` filtered by artifacts, then `restorePaths`/`removeUntracked`), which deletes B's `.planning/quick/<id>/…PLAN.md` that its resumed session expects. (c) After resume, `changedSince(snapshotTakenBeforePause)` would include C's committed changes.
**Why it happens:** Phase 2 had one item; nothing ever ran between a pause and a resume.
**How to avoid:** At pause, **park** B: take `snapshot()` of the dirty tree (a tree object, index untouched), then `discard()` to B's start snapshot. At resume, take a fresh snapshot S2 at the new HEAD, **unpark** (apply the delta between B's start snapshot and the parked tree; a path that HEAD changed since is a conflict, so open a decision), then `--resume`. Gate and commit B against S2. Keep the parked tree reachable with a ref so `gc` cannot drop it, and record its tree ID and the path list in a `park` run step. Also restrict `commitUnit`'s artifact cleanup to paths changed since the item's own snapshot.
**Warning signs:** C's G2 fails with `checks-delta` caused by B's files; B's resumed session cannot find its PLAN; the commit of B contains C's files.

### Pitfall 2: The live pause is invisible (no `question`), so the model silently picks
**What goes wrong:** The exit's planted ambiguity ends with the model choosing and finishing; G2 passes; D-02 counts that as failure.
**Why it happens:** `StreamJsonParser` deliberately keeps no result text (header: "Model text never leaves this file"), the host outcome carries no `question`, and the findings record that attended sessions made the edit instead of asking.
**How to avoid:** (1) Keep a bounded tail of the final `result` text in the parser (cap about 2000 characters, the size `detectPause` reads), strip with `storedText`, hand it only through `InvocationOutcome.question`, never into events (the 1024-character event limit and T-01-43 stay). (2) Add the "stop and ask" sentence naming the `human` classes to the unit prompt. (3) Add G1's `decision-checkpoint-unresolved` rule so a plan that carries an unanswered `checkpoint:decision` fails even when the unit finished. (4) Make the planted ambiguity unmistakable in the brief (an acceptance criterion that says the behaviour is for the owner to decide) and measure it in spike S3-A before spending on the portfolio.
**Warning signs:** `classify` records `pauseSignal: null` on a unit whose PLAN mentions "Scope decision for you to confirm"; zero decisions opened on an exit run that expects one.

### Pitfall 3: Lost wakeup between "nothing ready, block" and a concurrent `decide`
See Pattern 2. Without the release-and-recheck, a run can sit in `blocked_on_decision` with a `ready` item and no supervisor, shown as blocked while the answer is already recorded. Needs a fault test with `faultPoint` between the block transition and the release, and a concurrent-process test.

### Pitfall 4: `--resume` is not a drop-in for `--session-id`
**What goes wrong:** The CLI refuses both together (`Error: --session-id can only be used with --continue or --resume if --fork-session is also specified.`), a missing session prints `No conversation found with session ID: <id>`, and the reap searches for `--session-id <uuid>` only, so a resumed host that outlives its supervisor is never reaped. `[VERIFIED: ran claude -p with literal UUIDs on 2.1.319]`
**How to avoid:** Add `resumeSessionId` to the vendor-neutral request; the builder emits `--resume <id>` **instead of** `--session-id` (not `--fork-session`: a fork gets a new ID, which would break the recorded `work_items.gsd_session`); extend `reapBySessionId` to match `--resume <uuid>` as well; record the `launch:run` step with the same session ID so a kill mid-resume is reapable. `--resume` is already in `VALUE_FLAGS` and not in `WIDENING_FLAGS` `[VERIFIED: src/adapters/host-claude/launch-args.ts:83 `'--resume',` and :88 `new Set(['--add-dir', '--allowedTools', '--allowed-tools', '--permission-prompt-tool'])`]`. **Fallback is mandatory:** if the host reports no conversation (exit non-zero, no result event), run a fresh unit for the item with the owner's answer embedded in the prompt as data under a "Decision recorded by the owner" line, and clear `gsd_session`.
**Also:** the read-before-edit hook keeps its reads per invocation ID (`hook_reads`), so a resumed model that remembers reading a file but edits it without re-reading is denied `edit-without-read`. The resume prompt must say to read each file again before editing.

### Pitfall 5: Gate and commit scope after a repair or a resume
`changedSince(snapshot)` is relative to one snapshot. Use one **item base snapshot** (first attempt, or S2 after unpark) for G1, G2, `commitUnit` and the discard of a retry; use the attempt's own snapshot only for the CON-16 discard of that attempt. A retry discard of a resumed unit restores to S2, which also removes the unparked delta; that attempt then starts fresh with the answer in the prompt (Pitfall 4 fallback).

### Pitfall 6: Budgets sized for one item
D-12 scales `invocations`, sets cost 10.00 and wall clock 120 min, but says nothing about `subagentsTotal` (10) or `toolCalls` (400). One real unit used 4 subagents and 41 tool calls and cost 0.8996 USD `[CITED: spikes/phase-2-wave-0/S2-B-gsd-quick.md section 4]`; the derivation allows 5 subagents per unit and 2 rounds. Three items with a resume need up to 15-30 subagents, so `budget_exhausted` would end an exit run mid-way. Recommend `subagentsTotal = items x 10` and `toolCalls = max(400, items x 150)`, recorded as derivations like the existing ones, and confirmed by the owner (Open Question 1). `OVERRIDE_LIMITS` uses the constant preset values as the "can only lower" ceiling `[VERIFIED: src/domain/run-contract.ts:219-227, e.g. `subagentsTotal: { limit: ROUTINE_PRESET.budgets.subagentsTotal, integer: true },`]`; it and `applyBudgetOverrides` must take the scaled limits as input. Changing `ROUTINE_PRESET` also changes `policyRevision` for new runs and breaks `test/unit/run-contract.test.ts` pins; stored contracts keep their own stored revision, so an amend must copy it, not recompute it.

### Pitfall 7: A budget-only amendment re-opens every decision
Any contract version bump changes the state digest (D-15), including `--budget cost=8`. A user who amends to unblock a `budget_exhausted` decision then finds the answer stale. Accept this (it is what D-03 run 2 needs) but make the stale re-open say why and print the one-line next command; do not special-case budget amendments.

### Pitfall 8: A stage that changes item state but not run state
The supervisor loop errors with "stage made no progress" when the run row's state and version are unchanged. After each item, transition `running -> running`; for park and unpark, the checkpoint writes alone do not bump the version.

### Pitfall 9: `items:` frontmatter limits
The brief parser accepts flat `key: value` scalars only, refuses unknown keys and lines over 4096 characters, and caps the brief at 65536 bytes `[CITED: src/domain/brief.ts FRONTMATTER_KEYS and BRIEF_LIMITS, read via shell]`. Add `items` to `FRONTMATTER_KEYS`, read its value as JSON possibly continued on following lines that start with two spaces, then `JSON.parse` once; validate every field (IDs `^[A-Z][A-Za-z0-9_-]{0,31}$`, unique; `dependsOn` refers to existing IDs and is acyclic; acceptance lists are `AC<n>` IDs that exist in `## Acceptance criteria`, each in exactly one item; `size` and `model` in the existing enums). The `items` key must be left out of the digested content when absent so Phase 2 brief digests do not move (`content` is built key by key already).

### Pitfall 10: Notification text from the model
Decision `issue` is model text stored as data. A banner must not carry it unescaped or unbounded. Use AVARICE-owned words (count, run ID, decision ID, command), pass them as argv, strip control characters with the existing `stripControl`, and cap length.

### Pitfall 11: The installed `claude` is not admitted
`~/.local/bin/claude` points at 2.1.319; `launch-preflight` refuses with `host-version-not-admitted:2.1.319` `[VERIFIED: ls -l ~/.local/bin/claude; list at src/adapters/host-claude/launch-preflight.ts:22]` `[CITED: launch-preflight.ts, the `host-version-not-admitted:` refusal]`. Before any live spend either run the Phase 2 admission procedure on 2.1.319 (22 live cases, about 0.16 USD in Phase 2) and add it to the list, or run every live case with `AVARICE_CLAUDE_BIN=~/.local/share/claude/versions/2.1.318` (that binary exists). Decide in Wave 0 and record it. CON-3's rule is "admit only on a recorded live run on that exact version".

### Pitfall 12: Test-only and footprint guards will fail by design
`footprint.test.ts` pins the importers of `spawn-supervisor.ts` to `resume.ts` and `start.ts` (`assert.deepEqual(importers.map((f) => basename(f)).sort(), ['resume.ts', 'start.ts']);`), one `spawn(` in that file, and a fixed argument list (`'supervise', request.runId`) `[VERIFIED: test/unit/footprint.test.ts:88-103]`; new `spawn` sites for `osascript`, `launchctl` and `ps` live in other files and the "no detached child" scan allows only three files, so none of them may use `detached: true` or `unref()`. The coverage denominators (CLI commands 10, tables 23, event kinds 28, external systems 13, run transitions 37, work item states 6) change and `docs/system/coverage.md` must be re-counted by the documentation plan.

## Code Examples

### Identity check (CS-11 rule, one function used by decide, amend, schedule, cancel)
```typescript
// src/cli/ (adapter-facing; reads process) -- shape only
export interface Identity { uid: number; interactive: boolean; underRun: boolean; inRunTree: boolean; ownsProfile: boolean }
// interactive: process.stdin.isTTY === true && process.stdout.isTTY === true
// underRun:    env['AVARICE_RUN'] !== undefined   (pattern of install-host's usage())
// ownsProfile: statSync(dataRoot).uid === process.getuid()   (openDb already refuses a store owned by another user)
// inRunTree:   walk /bin/ps -o ppid=,command= up to pid 1; true when any ancestor command line contains
//              the supervisor signature `supervise run_` (fixed by the footprint test: [...execArgv, entry, 'supervise', runId])
```
Source: pattern from `src/cli/commands/install-host.ts` `usage()` `[VERIFIED: read via shell, lines 1-60]`; supervisor signature `[VERIFIED: test/unit/footprint.test.ts:~96 regex for the spawn arguments]`. The agent's own `avarice` calls are additionally refused by the hook (denied prefix `avarice` for every purpose) and carry no TTY and the `AVARICE_RUN` marker, so three independent layers refuse it `[CITED: STATE.md 02-08 decision]`.

### Banner with argv-only text
```typescript
// src/adapters/notify/local-notifier.ts -- verified approach
execFile('/usr/bin/osascript', [
  '-e', 'on run argv',
  '-e', 'display notification (item 1 of argv) with title (item 2 of argv)',
  '-e', 'end run',
  '--', text, title,
], { timeout: 10_000 }, cb);
```
Source: ran `osascript -e 'on run argv' -e 'return (item 1 of argv) & "|" & (item 2 of argv)' -e 'end run' -- 'x" & (do shell script "echo pwned") & "' 'title'` and the output was the literal string, exit 0 `[VERIFIED: ran on this machine]`.

### LaunchAgent plist (template; label and layout are discretionary)
```xml
<!-- ~/Library/LaunchAgents/<label>.plist, mode 0644; no admin rights. Install: launchctl bootstrap gui/<uid> <plist>;
     remove: launchctl bootout gui/<uid>/<label> then unlink. Validate with plutil -lint before bootstrap. -->
<dict>
  <key>Label</key><string>io.avarice.digest</string>
  <key>ProgramArguments</key><array><string>/abs/node</string><string>/abs/bin/avarice.ts</string><string>digest</string></array>
  <key>StartCalendarInterval</key><array>
    <dict><key>Hour</key><integer>12</integer><key>Minute</key><integer>30</integer></dict>
    <dict><key>Hour</key><integer>17</integer><key>Minute</key><integer>30</integer></dict>
  </array>
</dict>
```
Source: existing user agents on this machine use `Label`, `ProgramArguments`, `StartInterval`, `StandardOutPath` `[VERIFIED: ~/Library/LaunchAgents/com.claude-usage-watcher.plist]`; `StartCalendarInterval` array-of-dicts form `[ASSUMED]` (launchd.plist man page not fetched this session; confirm with `plutil -lint` and one real `launchctl bootstrap` in a test that uses a temp label and removes it).

### Resume launch line (vendor flags stay in the adapter)
```typescript
// buildLaunchArgs: replace the final ['--session-id', id] with ['--resume', id] when input.resumeSessionId is set.
// assertLaunchArgsSafe needs no change: '--resume' is in VALUE_FLAGS and not in WIDENING_FLAGS; every other
// containment flag is still required (settings, dontAsk, strict-mcp-config, max-budget-usd).
```
Source: `[VERIFIED: src/adapters/host-claude/launch-args.ts:27-57, 61-90]` and the CLI refusal above.

## State of the Art

| Old Approach (as built) | Phase 3 Approach | Impact |
|---|---|---|
| One item `A`, one unit, one attempt row per unit | N items, one `/gsd-quick` unit each, session ID per item in `work_items.gsd_session` | Every `items[0]` site, `blockRun` default, verify stage and attempt reason change |
| A blocked run is final in practice; no command answers a decision | `decide` answers; `blocked_on_decision -> ready` and `-> running` edges become driven | `findings.md` lines on decisions, unused edges and `resumeRun` stopped state are resolved |
| `repairAttemptsPerCheck: 0`, failing check ends the run | `1`, then `repeated_failure` with reproducer | `ROUTINE_PRESET` changes, so `policyRevision` changes for new runs |
| Contract version 1 only, budgets only grow in `used` | Amendments write version n+1 and may raise limits (D-19) | The Ledger port comment and docs/system claims "nothing raises a limit" change |
| Notification: inbox only | Inbox/status always plus banner, retry/backoff, digest | New port, adapter, table, profile config reader (the profile `config.json` is written once and never read today) |

**Deprecated/outdated:** `launchctl load/unload` (use `bootstrap/bootout`); the `findings.md` entries that describe Phase 2 limits this phase removes must be annotated as no longer holding by the documentation plan.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `launchd` accepts `StartCalendarInterval` as an array of `Hour`/`Minute` dicts and fires at each | Code Examples | Digest never fires; mitigated by a real temp-label bootstrap test |
| A2 | A resumed contained session accepts the same flag set (`--settings`, `--setting-sources ""`, `--permission-mode dontAsk`, `--max-budget-usd`) and honours a new hook policy per invocation | Pitfall 4 | Resume path fails and the fresh-unit fallback carries every answer; spike S3-A decides |
| A3 | A `/gsd-quick --validate --text` unit that needs a decision ends its `-p` turn with a numbered-choice question as the final result text (text mode replaces `AskUserQuestion` with a numbered list) | Pitfall 2 | `question` stays empty; need the `signal-waiting` verb or G1-only detection; spike S3-A decides. Source for text mode: `workflows/quick.md:50`, read this session |
| A4 | A quick-full PLAN cites contract acceptance IDs when the prompt asks for it, so G1 `plan-cites-acceptance` can be a hard rule | Pattern 3, Open Question 3 | Every run fails G1 spuriously; fallback is a recorded non-blocking finding |
| A5 | Failing test IDs can be extracted from vitest and node:test output well enough for the reproducer | Don't Hand-Roll | Reproducer lacks the test ID; command, output digest and diff still satisfy D-11 |
| A6 | Subagent and tool-call budgets should scale `subagentsTotal = items x 10`, `toolCalls = max(400, items x 150)` | Pitfall 6 | Exit runs hit `budget_exhausted` (too low) or the contract is looser than the owner intends (too high); owner confirms |
| A7 | G3 is satisfied by "no existing test file matching `testInventory.globs` is modified or deleted during the repair", plus the failing IDs still present | Pattern 6 | Too strict for a repair that legitimately edits a test (goes to a decision); too loose cannot happen because new test files are allowed only |
| A8 | `--add-write` and `--acceptance-file` amendments may widen only inside the conventions write set and off protected globs, reusing the compile-time rule | Pattern 5 | A user wanting wider scope is refused and must edit conventions and restart; owner may want a looser rule |
| A9 | The Phase 3 live portfolio runs cost about 10-14 USD in total (3 runs, 2-3 units each at about 0.9 USD, plus spikes, resume and one repair) against the 25 USD ceiling | Environment | Ceiling stops execution and asks the owner (D-05) |
| A10 | `claude -p --resume` on a session whose original `--max-budget-usd` was exhausted accepts a fresh cap | Pitfall 4 | Resume refused for budget; fresh-unit fallback |

## Open Questions

1. **Budgets not named by D-12 (`subagentsTotal`, `toolCalls`).**
   - What we know: one unit uses about 4 subagents and 41 tool calls; the preset caps are 10 and 400 for one item.
   - What's unclear: whether the owner wants them scaled with items.
   - Recommendation: scale as in Pitfall 6 and put the derivations in the contract; ask at the plan checkpoint.

2. **What can a user answer on a non-pause decision?** (`repeated_failure`, `permission`, `budget`, `scope_expansion`)
   - What we know: D-17 forbids `decide` from widening; the autonomy doc says nobody inside the run decides `prohibited` classes.
   - What's unclear: whether an answer such as `abandon item` (item and its dependents end, run goes on or fails) or `acknowledge` is wanted, or whether these are answered only by `contract amend` or `cancel`.
   - Recommendation: give them one option, `withdraw` (the decision becomes `withdrawn`, the item is marked failed through a new terminal item outcome or the run is failed), plus the printed amend command; keep options empty otherwise. Confirm the item-outcome model before planning the lifecycle change.

3. **G1 hard rules.** Recommend three hard rules (`plan-paths-in-scope` from the plan's `files_modified`/task `files`, `decision-checkpoint-unresolved`, `item-spec-files`) and one rule (`plan-cites-acceptance`) that is hard only after spike S3-B shows the plan cites IDs. The spec lists it as an exit condition (`docs/contracts-and-state.md` gate table).

4. **Cancellation (AUT-12).** No cancel command exists; `cancelled` is never entered and `withdrawn` is never written. Recommend `avarice cancel <run>` (terminal rules of D-14): with no live lease it takes the lease, withdraws open decisions, transitions to `cancelled`; with a live supervisor it records a cancel request that the lease-renewal timer already running every `ttl/3` reads, aborting the unit through the existing `AbortController`, then the stage loop transitions. The worktree is kept. Not in the proposal's CLI table: needs owner confirmation as a new command.

5. **Profile config reader.** The profile `config.json` has four keys, written once with `flag: 'wx'`, never read. Notify settings (D-21, D-24) need a reader that tolerates the existing file and any missing `notify` section, defaults `batchWindowMinutes: 10`, `quietHours` off, digest times `12:30` and `17:30`. Decide whether the file may be edited by hand only, or whether `avarice schedule install` writes defaults (recommend: hand-edited; install reads and reports).

6. **Which `claude` for the live runs** (admit 2.1.319 or pin 2.1.318). See Pitfall 11. Recommend admitting 2.1.319 with the Phase 2 procedure first because the owner's PATH will use it.

7. **How a Phase 2 run that is already `blocked_on_decision` behaves** (existing decisions have `options: []`). `decide` must handle an empty options list as "free text allowed" or refuse with a clear message; recommend refuse with the withdraw option of Question 2.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | everything | yes | 26.9.0 | none needed (engines `>=22.22.3`) |
| `claude` CLI | live cases, exit runs | yes, not admitted | 2.1.319 on PATH; 2.1.318 binary present | pin `AVARICE_CLAUDE_BIN` to 2.1.318, or admit 2.1.319 |
| `osascript` | banner | yes | system | none (banner failure is a recorded event by design) |
| `launchctl`, `plutil` | schedule | yes | system | none |
| `sandbox-exec` | contained host and checks | yes (Phase 2 runs used it) | system | none; no sandbox means no run |
| `npm run typecheck` | gate | yes (parent `node_modules` found by upward resolution) | tsc 7.0.2 | none |
| `~/aa-phan-portfolio-v2` | D-01 exit | yes (directory present; not inspected with git from this session) | pin `9f1cd8d` per STATE | none |
| Network egress | live model calls, `npm ci` through the proxy | assumed | not tested | stop and ask |

**Missing dependencies with no fallback:** none for planning. **With fallback:** host admission (above).

## Validation Architecture

> `workflow.nyquist_validation` is not set (`.planning/config.json` does not exist in this worktree), so the section is included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in, Node 26.9.0), TypeScript executed by type stripping `[VERIFIED: ran node --test]` |
| Config file | none; `package.json` scripts `test`, `test:unit`, `check:boundaries`, `typecheck` |
| Quick run command | `node --test test/unit/<file>.test.ts` (one file: 0.2 s); unit suite `node --test "test/unit/**/*.test.ts"` (1388 tests, 12.4 s, all green at start) |
| Full suite command | `node --test` (120 test files; five tests are load-sensitive and pass alone, see findings "Known load-sensitive tests") |
| Static gates | `npm run typecheck`, `node scripts/check-boundaries.ts` (79 files ok), footprint test |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUT-1 | `classifyDecision` maps each structural signal to class and authority; unclassifiable pause -> `human` | unit | `node --test test/unit/decision-policy.test.ts` | no, Wave 0 |
| AUT-2 | Record has options parsed from a numbered list, transitive affected items, recommendation | unit + integration | `node --test test/unit/decision-policy.test.ts test/integration/run-decisions.test.ts` | no, Wave 0 |
| AUT-3 / S-17 | A,B(depends A),C: B blocked, C done with evidence, no commit touches B's behaviour, run `blocked_on_decision`, one batched notification | integration (fake host) | `node --test test/integration/run-independent-work.test.ts` | no, Wave 0 |
| AUT-3 | Park/unpark keeps B's delta and quick records across C's commit | integration (real git) | `node --test test/integration/run-park.test.ts` | no, Wave 0 |
| AUT-4 / S-18 | Notifier fails every delivery, clock +72 h, decision still `open`, in `inbox` and `status`, no dependent work | integration (injected clock) | `node --test test/integration/run-silence.test.ts` | no, Wave 0 |
| AUT-5 | Response validation suite: wrong uid, no TTY, `AVARICE_RUN`, run tree, closed decision, unlisted option, free text on a closed record, duplicate, stale digest; rejected responses recorded | unit + integration | `node --test test/unit/response-validation.test.ts test/integration/decide.test.ts` | no, Wave 0 |
| AUT-5 | Lost-wakeup race: answer during block; kill point between block and release | fault | `node --test test/fault/decide-race.test.ts` | no, Wave 0 |
| AUT-6 | Banner argv-only (injection text stays literal), failure recorded, retry/backoff schedule, quiet hours hold | unit + integration | `node --test test/unit/notify-policy.test.ts test/integration/notifier.test.ts` | no, Wave 0 |
| AUT-6 | LaunchAgent plist text, `plutil -lint`, install/remove with a temp label | integration (macOS) | `node --test test/integration/schedule.test.ts` | no, Wave 0 |
| AUT-10 / S-21 | Deleted test, new skip marker, edited acceptance, new override, PRUNE, out-of-scope file, check-config change each fail a gate; after one repair a `repeated_failure` decision with reproducer | unit + integration | `node --test test/unit/gates.test.ts test/integration/run-repair.test.ts` | partly (`gates.test.ts` exists) |
| AUT-12 | Cancel at each state; resume after cancel request; withdrawn decisions | integration + fault | `node --test test/integration/run-cancel.test.ts test/fault/run-killpoints.test.ts` | partly |
| AUT-16 / S-52 | A done with checks green; B breaks A's test; failure charged to B; A stays `done` | integration | `node --test test/integration/run-regression.test.ts` | no, Wave 0 |
| RC-6 | Amend writes version n+1 with authorizer, reason, diff; invalidation per type (acceptance, write/protected, required checks, policy revision) appends `stale`; budget/notify invalidates nothing; refusal paths create no row | unit + integration | `node --test test/unit/amendment.test.ts test/integration/contract-amend.test.ts` | no, Wave 0 |
| RC-7 / S-50 | Three tasks, no sizes or files: each item has size and spec, `spec.derived` set, start summary lists them | unit + integration | `node --test test/unit/brief.test.ts test/unit/run-contract.test.ts` | exist; extend |
| RC-8 / S-51 | `small` and `large` items get `--model haiku` and `--model opus`; the invocation event records the model | integration | `node --test test/integration/run-models.test.ts` | no, Wave 0 |
| CON-15 / CS-5, CS-15 | Subagent calls draw from the same budget row across two items; `permissionMode` agent refused; live run-purpose cases | integration + live | `node --test test/integration/hook.test.ts test/unit/agent-frontmatter.test.ts`; live in `LIVE-CASES.md` | partly exist |
| Resume | `--resume` argv, reap matches `--resume`, missing session -> fresh-unit fallback | unit + integration | `node --test test/unit/launch-args.test.ts test/integration/claude-host.test.ts` | exist; extend |
| SC1-SC4 exit | Three portfolio runs (D-03) | live, owner-gated | `AVARICE_LIVE=1 AVARICE_PHASE3_PLAN=<id> node --test test/containment/live-run-phase3.test.ts` | no, Wave 0 |
| SC6 | docs/system current, README tables, coverage re-count, findings, prose review | manual + scripted counts | commands in `coverage.md`; `node scripts/check-boundaries.ts` | exists |

### Sampling Rate
- **Per task commit:** the one or two test files the task touches, plus `npm run typecheck`.
- **Per wave merge:** `node --test "test/unit/**/*.test.ts"`, `node scripts/check-boundaries.ts`, `npm run typecheck`, then the new integration files.
- **Phase gate:** full `node --test` green (rerun a load-sensitive failure alone before treating it as real), live suites only after the owner's spend checkpoint.

### Wave 0 Gaps
- [ ] `test/helpers/live-harness.ts`: generalize the Phase 2 ledger into a per-phase one (`live-spend-phase3.jsonl`, `AVARICE_PHASE3_LEDGER`, `AVARICE_PHASE3_CEILING_USD` that can only lower a 25 USD ceiling); keep Phase 2 names as wrappers; extend `test/unit/live-spend-ceiling.test.ts`. The Phase 2 code has six call sites of `fitsPhase2Ceiling`/`recordPhase2Spend`.
- [ ] `test/helpers/fake-run-host.ts`: per-item scripts (selected by the prompt's item title), a pause that returns `question`, a resumed invocation (`request.resumeSessionId`) that records the prompt and the answer, a missing-session error, subagent counts.
- [ ] Spike S3-A (live, small cap): pause as final-text numbered list, `--resume` under the contained line, missing-session behaviour, the "stop and ask" sentence effect, plan format with acceptance IDs and `checkpoint:decision` (feeds A2, A3, A4). Record under `spikes/phase-3-wave-0/`.
- [ ] Migration 0003 file, registration, `test/fault/migrations.test.ts` upgrade case and a new fixture.
- [ ] Host admission of 2.1.319 or the 2.1.318 pin (Pitfall 11).
- [ ] New test files listed in the map above; `test/unit/footprint.test.ts` updated for `decide.ts` as a `spawn-supervisor` importer and for the new spawn sites.
- [ ] Brief drafts for the three exit runs under `test/benchmark/portfolio/` (D-04), owner checkpoint before live spend.

## Security Domain

`security_enforcement` is not set to false in config (no config file), so this section applies.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes, local | No password (D-14); identity = OS user owning the profile on a TTY. Recorded as `answered_by`, `answer_channel = terminal` |
| V3 Session Management | no | No sessions; the host session ID is not an auth token |
| V4 Access Control | yes | The run can never raise a limit, answer a decision or amend: three layers (hook denied prefix `avarice`, no TTY plus `AVARICE_RUN`, process-tree walk); amend/decide/schedule/cancel refuse before the profile is resolved so a refusal creates nothing |
| V5 Input Validation | yes | Brief `items` JSON validated field by field; `--text` answer length and control characters bounded; amend flags validated (budget names, glob safety via `validateGlob`, check names); digest times `HH:MM` digits only; decision IDs matched against `dec_` pattern |
| V6 Cryptography | no | Only SHA-256 digests via `node:crypto` (existing) |
| V7 Error handling and logging | yes | Events carry IDs and counts only (1024/8192 limits); rejected responses recorded without the rejected text beyond a bounded, stripped form |
| V10 Malicious code / injection | yes | AppleScript injection (argv only), plist injection (fixed template), shell (no shell strings: `execFile` with argv) |
| V12 Files | yes | The LaunchAgent file is written with a temp file and rename, mode 0644, only under `~/Library/LaunchAgents`, refusing a symlink target (as `installSkill` does) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| The agent answers its own decision or amends its own contract | Elevation of privilege | CS-11 layers above; the decision row is only written by `decide`, which checks TTY, marker and ancestry |
| Model text in a banner becomes AppleScript | Tampering / Elevation | argv-only `osascript`, AVARICE-owned banner text, `stripControl`, length cap |
| A crafted answer (`--text`) carries instructions into the resumed session | Tampering | The answer is data: wrapped as a fenced "owner answer" line, length-capped, control characters stripped; it can never widen scope (D-17) |
| Replay of an old answer after state changed | Repudiation / Tampering | State digest check, stale re-open with the old answer as context only |
| Duplicate or racing answers | Tampering | Single transaction, state `open` required, first valid answer wins, later ones recorded and ignored |
| Redirected notifications (run adds a destination) | Information disclosure | Destinations only from the profile config; the contract may select a subset (D-21); the profile config home is denied to the run sandbox (Phase 2 CS-7 fix) |
| `--resume` of the wrong session | Tampering | Session ID read from `work_items.gsd_session` of the decision's affected item, not from user input; a missing session falls back to a fresh unit |
| Parked delta applied onto a changed path | Tampering (data loss) | Conflict detection at unpark opens a decision; never overwrite |
| LaunchAgent runs an attacker-controlled path | Elevation of privilege | `ProgramArguments` are absolute paths of the running Node and the CLI entry, validated as existing and absolute (as `spawnSupervisor` does) |

## Sources

### Primary (HIGH confidence)
- In-repo files read this session: `.planning/phases/03-.../03-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `src/app/run-stages/item.ts` (via Read, 889 lines); `src/domain/run-lifecycle.ts:128-165`, `src/domain/run-contract.ts:70-125`, `src/adapters/sqlite/ledger.ts:100-104`, `src/adapters/host-claude/launch-preflight.ts:20-23`, `src/adapters/host-claude/launch-args.ts:27-74`, `src/adapters/host-claude/claude-host.ts:372-383` (via Read); `src/app/run-service.ts`, `run-resume.ts`, `run-start.ts`, `run-status.ts`, `budget.ts`, `invocation.ts`, `run-gsd-config.ts`, `run-stages/{blocked,finish,prepare,discard,stage}.ts`, `src/domain/{brief,gates,outcome,quick-record}.ts`, `src/ports/{ledger,agent-host,run-workspace}.ts`, `src/adapters/sqlite/{ledger,events,migrate}.ts` and migrations 0001-0002, `src/adapters/host-claude/{stream-json,env}.ts`, `src/cli/{main,spawn-supervisor}.ts`, `src/cli/commands/{supervise,inbox,install-host}.ts`, `src/cli/shell/actions.ts`, `src/adapters/fs/profile-paths.ts`, `test/unit/footprint.test.ts`, `test/helpers/{fake-run-host,run-fixtures,live-harness}.ts`, `test/benchmark/portfolio/avarice-config.json`, `test/benchmark/r1/*.md` (via shell)
- `docs/contracts-and-state.md`, `docs/autonomy-and-decisions.md`, `docs/operations-and-testing.md`, `docs/implementation-plan.md` (Slice 2), `docs/extensions.md`, `docs/containment.md`, `docs/decisions/ADR-013`, `docs/system/{findings,coverage,README,integrations,containment}.md`, `spikes/phase-2-wave-0/S2-B-gsd-quick.md`, `test/containment/LIVE-CASES.md`
- Tool runs on this machine: `claude --help`, `claude --version`, two `claude -p ... --resume` error probes (no model call), `osascript` argv injection probe, `launchctl help`, `plutil` presence, `npm run typecheck`, `node --test` unit suite, `node scripts/check-boundaries.ts`

### Secondary (MEDIUM confidence)
- GSD core files under `~/.claude/gsd-core` (`workflows/quick.md`, `references/checkpoints.md`, `agents/gsd-executor.md`, `bin/gsd-tools.cjs`, `bin/lib/state.cjs`): `checkpoint:decision` structure and `auto_select`, text mode, `state signal-waiting`

### Tertiary (LOW confidence)
- None used for a recommendation. The launchd `StartCalendarInterval` form is `[ASSUMED]` (A1).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new packages; system tools verified present.
- Architecture: HIGH for what exists and what must change (read the code); MEDIUM for park/unpark and G3 internals (new designs, no precedent in the repo).
- Pitfalls: HIGH for code-derived ones (1, 3, 5, 6, 8, 9, 10, 12); MEDIUM for live-model ones (2, 4) until spike S3-A.

**Research date:** 2026-11-08
**Valid until:** 2026-11-22 (fast-moving: Claude Code releases roughly every few days and the admitted-version list changes with them)

## Suggested plan decomposition (for the planner; not a decision)

Phase 2 used 35 plans in waves; the same shape fits. The documentation plan is last and depends on all others (CLAUDE.md, SC6).

1. **Wave 0, foundations (no model spend except S3-A and admission):** Phase 3 spend ledger; host admission or pin; spike S3-A (pause, resume, plan format) with owner-visible result; migration 0003 and Ledger port additions (`answerDecision`, `staleDecision` plus re-open, `withdrawDecision`, `amendRunContract`, notifications, `attempts.item_id`); fake host extensions.
2. **Wave 1, pure domain (parallel):** brief `items` and compile of N items with derivation and scaled budgets; lifecycle edges (`implemented -> delegated`), next actions; `work-items.ts` scheduler; `decision-policy.ts`; `state-digest.ts`; `response-validation.ts`; G1 and G3; `amendment.ts`; `notify-policy.ts`.
3. **Wave 2, kernel wiring:** `loadUnit` and every `A` site; item stage scheduler loop with per-item attempts; `blockRun` with options, transitive affected items and the block/release/re-check protocol; park/unpark; repair; per-item reconcile in `run-resume.ts`; `question` capture and resume plumbing in the host adapter; prompt sentences.
4. **Wave 3, surfaces:** `decide` service and command (identity adapter, shell Decide action); `contract amend`; notifier port, local adapter, notifications table use, `digest`, `schedule install/remove`; `cancel`; inbox/status/render additions (optional keys only).
5. **Wave 4, proof:** offline suites (S-17, S-18, S-21, S-50, S-51, S-52, response validation, amendment invalidation, race and kill points); live scratch cases (S-17, S-18, S-21, S-50 to S-52, CS-5, CS-15) within the ledger; the three drafted briefs and the **owner checkpoint**; the three portfolio runs (3 of 3, re-run all three after any fix).
6. **Last plan:** documentation pass (D-25), diagrams for decision flow, README tables, coverage re-count (CLI commands, tables, event kinds, external systems, transitions, states), findings (the five conflicts of D-25 plus the entries this phase resolves), fresh prose review per changed document.
