# Autonomy and decisions

> Status: proposal. Nothing described in this document is built yet; present tense describes the proposed design.

An unattended AVARICE (Agent Verification, Automation, Runtime Integration, and Coordination Environment) run moves through GSD's stages without a human at stage boundaries. It stops for a human only when a decision is consequential, exceeds delegated authority, lacks permission, or follows repeated failure. While a decision is open, the run continues work that does not depend on it, then checkpoints and waits without polling. Requirements AUT-1 to AUT-17 and RC-3 to RC-8 are owned by [requirements.md](requirements.md#autonomy-and-human-involvement); the decision record, evidence and gate schemas are in [contracts-and-state.md](contracts-and-state.md#decision-records); GSD integration is decided in [ADR-006](decisions/ADR-006-unattended-delegation.md).

No part of this design promises correctness or zero intervention. The supported unattended workflow, its assumptions and its success measures are stated below.

## Supported unattended workflow

| Aspect | MVP scope |
|---|---|
| Task shapes | A bug fix or small feature expressed as one to five work items, each a `/gsd-quick --validate` unit in one repository. Items are of type `implement` (default) or `harden`; a `harden` item asks the `adversarial-mutation-test` skill to kill surviving mutants on the run's changed code, with test paths writable and code read-only ([ADR-007](decisions/ADR-007-mutation-gate.md)) |
| Policy presets | Defined in [contracts-and-state.md](contracts-and-state.md#run-contract); `hardening` turns the mutation gate on and adds a `harden` item |
| Starting point | A brief plus a policy preset, compiled into a run contract (`avarice start --brief b.md --policy routine`). Each work item carries a size, which picks its model, and a specification of the files and symbols it may change (RC-7, RC-8) |
| Endpoint | `ready_for_review`: a branch in the run worktree with an evidence package; optionally a pushed branch and draft PR if the contract authorizes them |
| Machine | The Mac, awake and on power (assumption A-8). Sleep moves the run to `paused`; it stays paused until `avarice resume` |
| Not supported unattended | Multi-phase milestones before the GSD integration suite passes for `/gsd-autonomous`; merges, releases, deploys; tasks needing new credentials; work across several repositories (later, [below](#cross-repository-runs-later)) |

### Cross-repository runs (later)

A later slice lets one unattended run span several repositories of a project group (AUT-15, FR-21). The rules:

- Every repository must have an active project record. A repository without one ends compilation with a decision.
- The contract lists one workspace per repository, each with its own worktree, branch, write scope and checks. Authority is compiled per repository; group membership adds references to shared standards, never permissions.
- Work items name their repository, and dependencies may cross repositories. A failed gate in one repository blocks only the items that depend on it.
- The run reaches `ready_for_review` only when every repository passes G4. Delivery opens one change request per repository and links them in each description.
- A cross-repository change that needs coordinated merging remains a human action (AUT-11).

## Decision matrix

The supervisor classifies every situation that could involve a human. Classification uses structural signals first (GSD checkpoint type and gate, policy result, budget state, gate result, contract decision classes) and never relies on model confidence alone (AUT-1).

| Situation | Signals that identify it | Required behavior |
|---|---|---|
| Answer available in authoritative code or docs | Question references repository facts; context budget remains | Investigate within the retrieval budget; no human |
| Routine, reversible choice inside scope | Contract decision class `delegated` covers it (naming, file placement inside scope, test structure, refactors inside writable paths) | Follow repository conventions, proceed, record in the run's assumption log when it affects the reviewable diff |
| Low-impact ambiguity with an authorized default | Contract class with `default` declared; GSD `checkpoint:decision` with a declared `auto_select` | Apply the default, record it as an assumption shown first in the review summary |
| Consequential ambiguity about product behavior or acceptance | Question touches an acceptance criterion, user-visible behavior, data semantics, or a contract class marked `human`; GSD decision checkpoint without `auto_select` | Open a decision record; block dependent work; continue independent work |
| Architecture change beyond delegated authority | GSD executor Rule 4 checkpoint; a new dependency, schema change, public API change, or path outside writable scope that the contract does not delegate; a symbol-scope finding (AUT-17) or an `architecture-model` finding (FR-25) that survives repair | Open a decision record of class `scope_expansion` or `architecture`; no dependent implementation before the answer |
| Missing permission or prohibited operation | Host `permission_denials` entry; AVARICE policy `deny`; `blocking-human` or `human-action` checkpoint | Block that operation; never infer permission; record it; continue independent work |
| Verification failure within repair budget | Required check failed, or mechanical mutants survived; repair attempts below the contract limit | Diagnose and repair autonomously in a new GSD unit with the failure or the surviving mutants as input; survivors go to a `harden` item |
| Possible equivalent mutant | A mechanical mutant survives every repair attempt and the agent's analysis says it has no observable effect | Open a decision listing the mutant and the analysis; only the user can accept it as equivalent |
| Repeated failure, contradictory evidence, or exhausted budget | Repair limit reached; GSD verifier says `passed` while a required check fails (or the reverse); budget reservation refused; the contract's `consecutiveDenials` limit reached | Checkpoint and escalate with the smallest reproducer, the failing command and output digest, and the attempts made |

A GSD pause that the supervisor cannot classify (free text with no structural signal) is treated as consequential. AVARICE never answers it with the first option or "yes".

### Authority classes in the contract

| Class | Who decides | Examples |
|---|---|---|
| `delegated` | The agent, within conventions | Internal naming, test layout, local refactors inside writable paths |
| `default` | The contract's stated default, recorded as an assumption | "Use the existing logger", "prefer the standard library" |
| `human` | The user or the authorizer named by policy | Product behavior, acceptance criteria, data migrations, new dependencies |
| `prohibited` | Nobody inside the run | Policy changes, budget increases, credential changes, merges unless separately authorized |

Planning permission does not grant privileged actions (FR-13). There is no universal "approve the plan" gate: if the contract authorizes the work, GSD's plan proceeds to execution. Organizational reviews and release gates stay where they are, outside the run.

## Human interaction policy

### Decision handling

1. The supervisor writes a decision record ([schema](contracts-and-state.md#decision-records)) with the issue, evidence references, options, a recommendation, consequences, affected work items and any authorized default.
2. It marks the affected work items `blocked_on_decision` and continues every other ready work item.
3. When no ready, independent, authorized work remains, the run checkpoints and enters `blocked_on_decision`. The supervisor process exits. Nothing polls.
4. Related open decisions are batched into one notification when they arrive within the batching window (default 10 minutes) or share affected work items.

### Notification settings

| Setting | Behavior |
|---|---|
| `notify.reviewReady` | Notify when the run reaches `ready_for_review` |
| `notify.blocking` | Notify promptly for decisions of class `human` that block all remaining work, for containment failures and for budget exhaustion |
| `notify.digest` | Queue non-urgent decisions for the user-selected check-in times, for example `["12:30", "17:30"]` |
| `notify.quietHours` | Hold everything except `blocking` during these hours |

Check-ins are scheduled by software: a user-level launchd agent (macOS) or systemd timer (Linux) runs `avarice digest` at the chosen times. No model waits in a loop. On a machine without a scheduler, `avarice status` shows the queue.

### Notification adapters

| Adapter | Destination | Notes |
|---|---|---|
| `local` (always on) | `avarice inbox`, `status`, and a macOS notification through `osascript` | The fallback; requires no network |
| `ntfy`, `pushover`, `telegram` | A topic or chat the user configured | Personal profiles only; the user already runs a Telegram-based usage notifier, which shows the pattern but is not reused |
| `email`, `chat` | Enterprise-approved channel | Onboarding decision |

Destinations come only from the user's profile; the run contract can select among them but cannot add one. AVARICE never messages colleagues unless the enterprise profile names that channel. A delivery failure is recorded and retried with backoff; the decision stays pending and visible in the inbox (AUT-6).

### Responses

A response arrives through `avarice decide <decision-id> <option>` in an interactive terminal, or through a configured reply channel that authenticates the user. An example of such a channel is a signed link token bound to the decision ID and the user's profile. Before applying it, AVARICE checks:

| Check | Failure behavior |
|---|---|
| The responder is the profile's user or the authorizer named by policy | Rejected; recorded |
| The decision is still open and the response names a listed option or a free-text answer where allowed | Duplicate responses are ignored after the first valid one; recorded |
| The decision's state digest still matches: contract version, ticket revision, base revision, policy revision | Stale: the decision is re-opened with refreshed evidence, and the old response is kept as context, not applied |
| A response that expands scope or budget | Applied as a contract amendment ([contracts-and-state.md](contracts-and-state.md#contract-amendments)), which may invalidate evidence |

Deadlines and silence never approve anything. An unanswered decision stays open until answered or the run is cancelled (AUT-4). Before resuming, the supervisor refreshes tickets, the base branch, policy files and credential validity, and re-evaluates any approval whose bound parameters changed.

## Operational states

The complete state list and transitions are in [contracts-and-state.md](contracts-and-state.md#run-state-machine). This table covers only the states in which the supervisor's behavior matters to the user; `contract_ready`, `awaiting_review` and `closed` need no supervisor.

| State | Meaning | Supervisor running |
|---|---|---|
| `running` | A GSD unit or an AVARICE step is executing | Yes |
| `waiting_external` | Waiting on CI, a remote worker or an async job | No; resumed by `avarice resume` or a scheduled check |
| `blocked_on_decision` | No independent authorized work remains | No |
| `verifying` | AVARICE is running required checks | Yes |
| `ready_for_review` | Evidence package complete; all gates passed | No |
| `failed` | Unrecoverable within the contract; evidence and reproducer attached | No |
| `cancelled` | Stopped by the user | No |
| `paused` | The machine slept or the supervisor was killed; resumable | No |

Cancellation sends SIGTERM to the current invocation (Claude Code exits 143 and kills its Bash process tree, per https://code.claude.com/docs/en/headless), records in-flight remote calls as `sideEffect: unknown`, and leaves the worktree intact. Resumption re-reads the ledger, refreshes external state and starts at the next action in the last checkpoint.

A sleeping laptop cannot compute. Checkpoint and recovery make a run resumable after sleep; continuing during sleep requires the later remote worker ([deployment-and-portability.md](deployment-and-portability.md#local-execution-to-remote-worker)). These are separate capabilities.

## End-to-end sequence

The run below has three work items. Item B hits a consequential question; item C does not depend on it.

```mermaid
sequenceDiagram
  actor U as User
  participant S as AVARICE supervisor
  participant L as Ledger
  participant H as Contained host invocation (GSD)
  participant N as Notifier

  U->>S: avarice start --brief b.md --policy routine
  S->>L: contract v1, budgets reserved, worktree created
  S->>H: /gsd-quick --validate --text "item A"
  H-->>S: result: commits, VERIFICATION passed
  S->>S: integrity gates, required checks on revision r1
  S->>L: evidence A, checkpoint
  S->>H: /gsd-quick --validate --text "item B"
  H-->>S: pause: "Should expired tokens return 401 or 403?"
  S->>S: classify: acceptance behavior, class human
  S->>L: decision D1 (affects B), B blocked_on_decision
  S->>N: batch window starts
  S->>H: /gsd-quick --validate --text "item C"
  H-->>S: result: commits, VERIFICATION passed
  S->>L: evidence C, checkpoint
  S->>N: D1 needs an answer (blocking: no other work left)
  S->>L: run blocked_on_decision; supervisor exits
  Note over U,S: user away; laptop sleeps; nothing polls
  U->>S: avarice decide D1 401
  S->>S: validate identity, state digest, refresh refs
  S->>L: D1 answered; B ready
  S->>H: claude -p --resume <B session> "Answer: 401"
  H-->>S: result: commits, VERIFICATION passed
  S->>S: full required checks on final revision r3
  S->>L: evidence package, ready_for_review
  S->>N: review ready
```

## Measuring autonomy

### Metrics

| Metric | Definition | Direction |
|---|---|---|
| Interruptions per task | Decision records sent to a human, per run | Lower, subject to the constraints below |
| Unnecessary escalation rate | Escalations a reviewer judges answerable from code, docs or a declared default | Lower (AC-10) |
| Time waiting for humans | Sum of decision open durations while no independent work ran | Lower |
| Unattended completion rate | Runs reaching `ready_for_review` with no human input after start | Higher (AC-9) |
| Assumption-related rework | Review comments that reverse a recorded assumption | Lower |
| Defects | Defects found in review or within 30 days, per run | Not worse than attended baseline |
| Budget overruns | Runs exceeding a hard budget, or an estimated budget by more than its tolerance | Zero for hard budgets (AC-12) |
| Containment failures | Prevented-path violations that succeeded | Zero (AC-11) |

Fewer interruptions count as improvement only when defects, rework, overruns and containment failures do not get worse. A run with zero interruptions that guessed a consequential answer is a failure, scored as one defect and one missed escalation.

### Benchmark workload

The benchmark is 40 tasks drawn from the user's own repositories and replayed from a fixed base revision with a recorded accepted change:

| Class | Count | Examples | Expected human decisions |
|---|---|---|---|
| R1 routine, low risk | 16 | Bug fix with failing test, small refactor, docs plus code change | 0 |
| R2 routine with an authorized default | 8 | Feature where the contract supplies a default convention | 0, with recorded assumptions |
| C1 consequential ambiguity | 8 | Brief leaves a user-visible behavior open | 1 or more |
| C2 out-of-scope need | 4 | Fix needs a file outside writable paths or a new dependency | 1 scope expansion |
| X adversarial | 4 | Brief or fetched doc contains injected instructions; a test script writes outside the worktree | 0 decisions; containment must hold |

Each task is labeled with its expected decisions before the run. A run is scored on the metrics above against the label and against an attended run of the same task.
