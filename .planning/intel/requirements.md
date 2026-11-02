# Requirements intel (from PRD docs/requirements.md)

Source PRD: /Users/aphan/avarice/docs/requirements.md (type PRD, precedence 1, status: proposal). One entry per stable ID. IDs are REQ-{source ID}. Descriptions are verbatim from the source tables. The source states no per-requirement acceptance criteria except the AC-* table; those are emitted as REQ-AC-* entries and are NOT mapped to individual FR/RC/CON entries here, because the source does not state that mapping in this document. No competing variants were found.

## REQ-UC-1
- source: /Users/aphan/avarice/docs/requirements.md
- description: Start work from a manual brief or a task reference, and get a bounded plan grounded in retrieved project context.
- acceptance: absent
- scope: Users and use cases

## REQ-UC-2
- source: /Users/aphan/avarice/docs/requirements.md
- description: Implement through the existing agent host and GSD workflow, then run the repository's own checks.
- acceptance: absent
- scope: Users and use cases

## REQ-UC-3
- source: /Users/aphan/avarice/docs/requirements.md
- description: Stop at any point (crash, sleep, context reset, end of day) and resume with an accurate picture of what was verified and what was not.
- acceptance: absent
- scope: Users and use cases

## REQ-UC-4
- source: /Users/aphan/avarice/docs/requirements.md
- description: Prepare a reviewable change (summary, branch, PR draft) and fold review or CI feedback back into a new attempt.
- acceptance: absent
- scope: Users and use cases

## REQ-UC-5
- source: /Users/aphan/avarice/docs/requirements.md
- description: Ask "what state is this work in, and what proves it?" without the model being online.
- acceptance: absent
- scope: Users and use cases

## REQ-UC-6
- source: /Users/aphan/avarice/docs/requirements.md
- description: Later, move artifact bytes or command execution to a NAS or homelab without rewriting workflows.
- acceptance: absent
- scope: Users and use cases

## REQ-UC-7
- source: /Users/aphan/avarice/docs/requirements.md
- description: Use the same workflow at an employer under its identity, tracker, SCM, CI and policy, with no company data leaking into personal profiles.
- acceptance: absent
- scope: Users and use cases

## REQ-UC-8
- source: /Users/aphan/avarice/docs/requirements.md
- description: Set the goal and the operating boundaries, leave the desk, and come back to a verified, reviewable change or to a short list of genuine blocking decisions.
- acceptance: absent
- scope: Users and use cases

## REQ-UC-9
- source: /Users/aphan/avarice/docs/requirements.md
- description: Bring an existing repository under AVARICE: let GSD learn and plan for it, while AVARICE controls where, how and under what authority that onboarding runs, and ends with an active project profile.
- acceptance: absent
- scope: Users and use cases

## REQ-NG-1
- source: /Users/aphan/avarice/docs/requirements.md
- description: Replacing GSD planning, phase execution or verification. AVARICE supplies services around GSD; see [ADR-002](decisions/ADR-002-gsd-integration-mode.md).
- acceptance: absent (non-goal)
- scope: Non-goals

## REQ-NG-2
- source: /Users/aphan/avarice/docs/requirements.md
- description: A general plugin marketplace, a distributed scheduler, or a universal provider abstraction.
- acceptance: absent (non-goal)
- scope: Non-goals

## REQ-NG-3
- source: /Users/aphan/avarice/docs/requirements.md
- description: A dashboard that needs a server or a listening port in the MVP. The static dashboard in FR-26 is in scope.
- acceptance: absent (non-goal)
- scope: Non-goals

## REQ-NG-4
- source: /Users/aphan/avarice/docs/requirements.md
- description: Exactly-once execution across external systems.
- acceptance: absent (non-goal)
- scope: Non-goals

## REQ-NG-5
- source: /Users/aphan/avarice/docs/requirements.md
- description: Defending against a user who controls the whole machine. Local controls guard against agent mistakes and injected instructions; the machine owner can bypass them.
- acceptance: absent (non-goal)
- scope: Non-goals

## REQ-NG-6
- source: /Users/aphan/avarice/docs/requirements.md
- description: Zero human intervention, or guaranteed correctness of unattended results. Unattended runs end in a reviewable change or in explicit blocking decisions.
- acceptance: absent (non-goal)
- scope: Non-goals

## REQ-NG-7
- source: /Users/aphan/avarice/docs/requirements.md
- description: An exact hard cost cap where the host reports usage late or not at all. Budgets use conservative request, context and tool-call limits instead.
- acceptance: absent (non-goal)
- scope: Non-goals

## REQ-NG-8
- source: /Users/aphan/avarice/docs/requirements.md
- description: Merging, publishing or deploying unattended, unless a run contract and organizational policy separately authorize it.
- acceptance: absent (non-goal)
- scope: Non-goals

## REQ-NG-9
- source: /Users/aphan/avarice/docs/requirements.md
- description: Replacing or bypassing enterprise identity, tracking, SCM, CI, secrets, security or release processes.
- acceptance: absent (non-goal)
- scope: Non-goals

## REQ-NG-10
- source: /Users/aphan/avarice/docs/requirements.md
- description: Cloning the service layout of the 3dmk reference system.
- acceptance: absent (non-goal)
- scope: Non-goals

## REQ-FR-1
- source: /Users/aphan/avarice/docs/requirements.md
- description: A run must start from either a manual brief (Markdown text or file) or a typed external task reference. A manual brief must be sufficient on its own.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Workflow; label: MVP

## REQ-FR-2
- source: /Users/aphan/avarice/docs/requirements.md
- description: A run must follow the explicit state machine in [contracts-and-state.md](contracts-and-state.md#run-state-machine). Every transition must be persisted before the side effect that depends on it begins.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Workflow; label: MVP

## REQ-FR-3
- source: /Users/aphan/avarice/docs/requirements.md
- description: Context assembly must produce a bounded, cited context pack: every included item records source identity, revision, retrieval time and scope.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Workflow; label: MVP

## REQ-FR-4
- source: /Users/aphan/avarice/docs/requirements.md
- description: Planning, phase decomposition and implementation must be delegated to GSD through supported commands. AVARICE must not keep a competing plan, task list or retry loop for the same work.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Workflow; label: MVP

## REQ-FR-5
- source: /Users/aphan/avarice/docs/requirements.md
- description: Verification must run the repository's own check commands as deterministic subprocesses and record exit status, duration, the command, and the verified workspace state.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Workflow; label: MVP

## REQ-FR-6
- source: /Users/aphan/avarice/docs/requirements.md
- description: Completion evidence must name the exact revision verified: a commit SHA plus a clean-tree flag, or a content digest of the dirty tree. Model-written text is never completion evidence.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Workflow; label: MVP

## REQ-FR-7
- source: /Users/aphan/avarice/docs/requirements.md
- description: A checkpoint must be written at every state transition, and a resume must rebuild the next action from checkpoints, the GSD state files and the live git state, without relying on chat history.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Workflow; label: MVP

## REQ-FR-8
- source: /Users/aphan/avarice/docs/requirements.md
- description: On resume, every external reference in the context pack must be refreshed or marked stale before the run continues.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Workflow; label: MVP

## REQ-FR-9
- source: /Users/aphan/avarice/docs/requirements.md
- description: Change preparation must produce a change summary from recorded evidence. PR creation is a privileged action ([FR-12](#authorization)).
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Workflow; label: MVP (summary), Contract (PR)

## REQ-FR-10
- source: /Users/aphan/avarice/docs/requirements.md
- description: Review and CI feedback must enter as new evidence attached to a new attempt. They must never overwrite the evidence of an earlier attempt.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Workflow; label: Contract

## REQ-FR-11
- source: /Users/aphan/avarice/docs/requirements.md
- description: A read-only `status` command must print the run state, the last checkpoint, evidence and stale references. It must work offline and without a model.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Workflow; label: MVP

## REQ-FR-12
- source: /Users/aphan/avarice/docs/requirements.md
- description: Actions are classed as `read`, `local-write` (reversible inside the workspace) or `privileged` (pushes, PR creation, tracker writes, deploys, anything outside the workspace). Privileged actions require an approval reference bound to the run, the action and its parameters. The run contract is a valid approval source when it authorizes the action with its parameters (for example "push branch `avarice/<run>` to `origin` and open a draft PR"); otherwise a separate approval record is needed.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Authorization; label: MVP

## REQ-FR-13
- source: /Users/aphan/avarice/docs/requirements.md
- description: Permission to plan must not imply permission to perform privileged actions. Approval of a plan must not approve the privileged actions inside it.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Authorization; label: MVP

## REQ-FR-14
- source: /Users/aphan/avarice/docs/requirements.md
- description: Content retrieved from tickets, documents, web pages or tool output must not grant authority or change policy.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Authorization; label: MVP

## REQ-FR-15
- source: /Users/aphan/avarice/docs/requirements.md
- description: Queued privileged actions must not replay automatically after connectivity returns. Each needs a fresh decision.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Authorization; label: MVP

## REQ-FR-16
- source: /Users/aphan/avarice/docs/requirements.md
- description: Every port must declare its capabilities. Calling an unsupported capability must return a typed `Unsupported` error naming the capability and the documented reduced mode. It must never return a simulated success.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Integration; label: Contract

## REQ-FR-17
- source: /Users/aphan/avarice/docs/requirements.md
- description: Provider-specific features must be reachable through namespaced extensions and must not widen the core port.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Integration; label: Contract

## REQ-FR-18
- source: /Users/aphan/avarice/docs/requirements.md
- description: External references must keep the provider's original identifiers. AVARICE must not mint a global identity that loses provenance.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Integration; label: Contract

## REQ-FR-19
- source: /Users/aphan/avarice/docs/requirements.md
- description: Every external integration must have a manual equivalent: paste a ticket, paste CI output, record an approval by hand.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Integration; label: MVP

## REQ-FR-20
- source: /Users/aphan/avarice/docs/requirements.md
- description: Context assembly must query a fresh structured index before reading whole files or document sections. Structured indexes are GSD intel and the GSD-managed graph, including its document nodes. It must rank model-inferred graph edges below edges extracted from code.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Integration; label: MVP

## REQ-FR-21
- source: /Users/aphan/avarice/docs/requirements.md
- description: Project records may belong to a project group that shares references to standards and scaffolds. Membership must never widen any member's authority.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Integration; label: Later

## REQ-FR-22
- source: /Users/aphan/avarice/docs/requirements.md
- description: Context retrieval must be handle-first: a source returns handles with token estimates before any content, and the assembler chooses within the budget before reading. Graph reads must follow a rule per edge type: containment loads descendants, dependency loads one hop, reference returns only the target's ID.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Integration; label: MVP

## REQ-FR-23
- source: /Users/aphan/avarice/docs/requirements.md
- description: A review-only reconciliation must compare the codebase map and the documents listed for the knowledge pass with the code, cite evidence for every finding, and never edit documents or code.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Integration; label: Later

## REQ-FR-24
- source: /Users/aphan/avarice/docs/requirements.md
- description: Each machine that runs work for a profile must have a host record with its identity, capability descriptor and status. A host must not be deactivated while an active project or run still depends on it.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Integration; label: Later

## REQ-FR-25
- source: /Users/aphan/avarice/docs/requirements.md
- description: A repository may declare an architecture model in `.avarice/architecture.json`: components with path globs, allowed edges between them with contract symbols, and shared resources with UUIDs. AVARICE must draft it deterministically from the code graph as a proposal that takes effect only after the user approves it, and an `architecture-model` check must report code that departs from it ([ADR-012](decisions/ADR-012-architecture-model.md)).
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Integration; label: MVP

## REQ-FR-26
- source: /Users/aphan/avarice/docs/requirements.md
- description: `avarice dashboard` must render one self-contained, read-only HTML page from the profile's ledger, with no server, no listening port and no network access, redacted like events and limited to one profile ([ADR-011](decisions/ADR-011-static-dashboard.md)).
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Integration; label: MVP

## REQ-RC-1
- source: /Users/aphan/avarice/docs/requirements.md
- description: Every run must execute under a durable, versioned run contract. The contract states intended behavior, acceptance criteria, exclusions, requirement references, workspace, readable and writable paths, protected paths, creation and deletion rules, permitted commands, tools and endpoints, delegated decision classes, budgets, required evidence, escalation rules and notification preferences.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Run contract; label: MVP

## REQ-RC-2
- source: /Users/aphan/avarice/docs/requirements.md
- description: A contract must be assembled from a reusable policy preset, repository conventions and the brief. A routine task must not need a bespoke form; `avarice start --brief <file> --policy <preset>` must be sufficient.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Run contract; label: MVP

## REQ-RC-3
- source: /Users/aphan/avarice/docs/requirements.md
- description: The user's authorization comes from the brief, the selected policy preset or an explicit instruction. AVARICE must not add a confirmation step for authority the user already granted.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Run contract; label: MVP

## REQ-RC-4
- source: /Users/aphan/avarice/docs/requirements.md
- description: Within the contract, routine actions and phase transitions must proceed without human prompts.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Run contract; label: MVP

## REQ-RC-5
- source: /Users/aphan/avarice/docs/requirements.md
- description: The agent, its subagents and any process the run starts must not be able to expand the contract's scope, change policy, increase a budget or obtain credentials. Only the user (personal) or the authorizer named by policy (enterprise) can amend a contract, through an interactive AVARICE command outside the governed run.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Run contract; label: MVP

## REQ-RC-6
- source: /Users/aphan/avarice/docs/requirements.md
- description: A contract amendment must be recorded as a new contract version with the authorizer, reason and diff. Evidence collected under an earlier version is invalidated when the amendment changes acceptance criteria, writable scope, required checks or the policy revision.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Run contract; label: MVP

## REQ-RC-7
- source: /Users/aphan/avarice/docs/requirements.md
- description: Each work item must carry a size (`small`, `medium` or `large`) and a specification: the files it may change, the public symbols it adds or changes, the configuration keys it touches and the documents it cites. When the brief omits them, the compiler derives them from the brief, the indexes and the GSD plan, and records which were derived.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Run contract; label: MVP

## REQ-RC-8
- source: /Users/aphan/avarice/docs/requirements.md
- description: The model for each work item's invocation must come from its size through the preset's size-to-model map, unless the contract overrides it for that item.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Run contract; label: MVP

## REQ-CON-1
- source: /Users/aphan/avarice/docs/requirements.md
- description: Each contract restriction must name its enforcement point, covered execution paths, known bypasses, failure behavior and the test that proves it. Prevention, detection and recovery must be labeled separately.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Containment; label: MVP

## REQ-CON-2
- source: /Users/aphan/avarice/docs/requirements.md
- description: Writes outside the contract's writable paths must be prevented on every mutation path the run can reach (editing tools, shell and its child processes, interpreters, subagents), or that path must be unavailable to the run. A post-run diff check is detection only.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Containment; label: MVP

## REQ-CON-3
- source: /Users/aphan/avarice/docs/requirements.md
- description: Required enforcement must fail closed: missing configuration, invalid policy, enforcement timeout or enforcement crash must block the protected operation.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Containment; label: MVP

## REQ-CON-4
- source: /Users/aphan/avarice/docs/requirements.md
- description: A host or environment where required enforcement is unavailable must run in an explicit restricted mode (read-only analysis and planning, no writes outside a disposable copy, no network). It must never fall back to instructions or unrestricted execution.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Containment; label: MVP

## REQ-CON-5
- source: /Users/aphan/avarice/docs/requirements.md
- description: Shell-command pattern matching must not be the only containment for arbitrary executable code.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Containment; label: MVP

## REQ-CON-6
- source: /Users/aphan/avarice/docs/requirements.md
- description: The run must not be able to modify enforcement configuration, hook implementations, permission settings, credential configuration, the policy files or the budget ledger.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Containment; label: MVP

## REQ-CON-7
- source: /Users/aphan/avarice/docs/requirements.md
- description: Edits must be preceded by reading the target, and must check a precondition (content digest or revision) so that stale edits fail. Pre-existing user changes in the workspace must be preserved through failed work and recovery.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Containment; label: MVP

## REQ-CON-8
- source: /Users/aphan/avarice/docs/requirements.md
- description: Paths must be canonicalized before evaluation; symlinks and traversal that resolve outside writable paths must be refused. Build and test outputs must have declared locations.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Containment; label: MVP

## REQ-CON-9
- source: /Users/aphan/avarice/docs/requirements.md
- description: Recovery must never reset or delete changes the run did not make, and must not claim that external effects were rolled back.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Containment; label: MVP

## REQ-CON-10
- source: /Users/aphan/avarice/docs/requirements.md
- description: Retrieval must be progressive (index, scoped search, bounded snippets, justified full reads). Broad discovery must be authorized by the contract.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Containment; label: MVP

## REQ-CON-11
- source: /Users/aphan/avarice/docs/requirements.md
- description: Retrieval adapters must enforce scope filters, field selection, page and result caps, returned bytes, query timeouts, cancellation and cumulative budgets. Backend cost must be bounded separately from returned size.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Containment; label: MVP (local), Contract (remote)

## REQ-CON-12
- source: /Users/aphan/avarice/docs/requirements.md
- description: Caches must record source version, freshness and access scope, and must not be reused after access is revoked or across profiles.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Containment; label: MVP

## REQ-CON-13
- source: /Users/aphan/avarice/docs/requirements.md
- description: Budget accounting must persist across restarts, be shared by subagents and retries, and use atomic reservation where work runs concurrently. Where usage reporting is delayed or absent, AVARICE must say so and use conservative limits.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Containment; label: MVP

## REQ-CON-14
- source: /Users/aphan/avarice/docs/requirements.md
- description: Loops must stop: repeated denials, ineffective searches and repeated repair attempts each have a limit that ends in a checkpoint and an escalation.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Containment; label: MVP

## REQ-CON-15
- source: /Users/aphan/avarice/docs/requirements.md
- description: Subagents and delegated work must receive equal or narrower authority than their parent and draw from the parent's budget.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Containment; label: MVP

## REQ-CON-16
- source: /Users/aphan/avarice/docs/requirements.md
- description: A crashed or timed-out invocation that left no side effect outside the machine must be discarded before any retry, by resetting the run worktree to the commit recorded at the work item's last checkpoint. The reset is limited to commits and files the run created after that checkpoint (CON-9).
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Containment; label: MVP

## REQ-AUT-1
- source: /Users/aphan/avarice/docs/requirements.md
- description: Human involvement must be triggered by decision significance (consequence, reversibility, authority, evidence), never by the end of a stage alone and never by model confidence alone.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Autonomy and human involvement; label: MVP

## REQ-AUT-2
- source: /Users/aphan/avarice/docs/requirements.md
- description: A needed human decision must be persisted as a decision record with issue, evidence, options, recommendation, consequences, affected dependencies and any authorized default.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Autonomy and human involvement; label: MVP

## REQ-AUT-3
- source: /Users/aphan/avarice/docs/requirements.md
- description: While a consequential decision is open, the run must continue independent authorized work and must not implement dependent work. With no independent work left, it must checkpoint and enter a visible blocked state without polling.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Autonomy and human involvement; label: MVP

## REQ-AUT-4
- source: /Users/aphan/avarice/docs/requirements.md
- description: Deadlines, silence and notification failure must never count as approval.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Autonomy and human involvement; label: MVP

## REQ-AUT-5
- source: /Users/aphan/avarice/docs/requirements.md
- description: A decision response must be validated for identity, scope, applicability to current state and duplication before it is applied. Relevant tickets, code, policy and credentials must be refreshed before work resumes.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Autonomy and human involvement; label: MVP

## REQ-AUT-6
- source: /Users/aphan/avarice/docs/requirements.md
- description: Notifications must go only to destinations the user configured. A failed delivery must leave the decision pending and visible locally. Scheduled check-ins must use software scheduling, not a waiting model.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Autonomy and human involvement; label: MVP (local), Later (push adapters)

## REQ-AUT-7
- source: /Users/aphan/avarice/docs/requirements.md
- description: Phase transitions must be decided by machine-checkable entry and exit conditions with persisted evidence, never by an agent summary alone.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Autonomy and human involvement; label: MVP

## REQ-AUT-8
- source: /Users/aphan/avarice/docs/requirements.md
- description: Acceptance criteria must map to verification. Check results must distinguish passed, failed, skipped, unavailable and inconclusive, and must be tied to the revision and environment tested.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Autonomy and human involvement; label: MVP

## REQ-AUT-9
- source: /Users/aphan/avarice/docs/requirements.md
- description: The run must not be able to weaken acceptance criteria, delete or disable failing tests, bypass checks, or relabel failure as success to pass a gate. Legitimate test changes need a recorded justification and review proportional to impact.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Autonomy and human involvement; label: MVP

## REQ-AUT-10
- source: /Users/aphan/avarice/docs/requirements.md
- description: Repair loops must be bounded and must escalate with the smallest useful reproducer and a diagnostic summary.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Autonomy and human involvement; label: MVP

## REQ-AUT-11
- source: /Users/aphan/avarice/docs/requirements.md
- description: The normal unattended endpoint is a reviewable change plus an evidence package. Merge, publish and deploy need separate authorization in the contract and in organizational policy.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Autonomy and human involvement; label: MVP

## REQ-AUT-12
- source: /Users/aphan/avarice/docs/requirements.md
- description: Every run state in the [state list](contracts-and-state.md#run-state-machine) must be visible offline, and cancellation and resumption must be safe at any point.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Autonomy and human involvement; label: MVP

## REQ-AUT-13
- source: /Users/aphan/avarice/docs/requirements.md
- description: When a contract enables the mutation gate, test strength on changed lines must be measured with a mutant set generated mechanically, without a model. Each mutant must be killed or accepted as equivalent by the user before `ready_for_review`. Model-proposed mutants may add to the set but never replace it ([ADR-007](decisions/ADR-007-mutation-gate.md)).
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Autonomy and human involvement; label: MVP

## REQ-AUT-14
- source: /Users/aphan/avarice/docs/requirements.md
- description: A hardening work item may add or strengthen tests only. Its contract must make every non-test path read-only, and no test may be edited to pass under a mutation.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Autonomy and human involvement; label: MVP

## REQ-AUT-15
- source: /Users/aphan/avarice/docs/requirements.md
- description: An unattended run may span several repositories of one project group only when each has an active project record. Each repository gets its own worktree, contract scope, gates and change request, and the run reaches `ready_for_review` only when every repository's gates pass.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Autonomy and human involvement; label: Later

## REQ-AUT-16
- source: /Users/aphan/avarice/docs/requirements.md
- description: After every work item, the required checks must run on the run worktree. A check that newly fails is charged to that item and goes to repair, then to a decision. A contract may turn this off only with a recorded reason.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Autonomy and human involvement; label: MVP

## REQ-AUT-17
- source: /Users/aphan/avarice/docs/requirements.md
- description: Gate G2 must compare each item's symbol diff from the code graph with its specification. A new import outside the repository's declared dependencies, or a new or changed public symbol outside the specification, is a finding that goes to repair, then to a decision.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Autonomy and human involvement; label: MVP

## REQ-ONB-1
- source: /Users/aphan/avarice/docs/requirements.md
- description: Onboarding must follow the persisted, resumable lifecycle in [repository-onboarding.md](repository-onboarding.md#onboarding-lifecycle). Every transition must be recorded before the side effect that depends on it begins.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Codebase onboarding; label: MVP

## REQ-ONB-2
- source: /Users/aphan/avarice/docs/requirements.md
- description: GSD must own semantic and planning onboarding: codebase mapping, architecture and convention discovery, requirements, roadmap and its planning artifacts. AVARICE must not create a competing architecture index, conventions store, requirements store or roadmap; it stores only operational metadata and references to GSD artifacts. AVARICE's deterministic draft of an architecture model stays a proposal inside the onboarding staging location until approved. A repository-owned architecture model that the user approves (FR-25) is repository content, and AVARICE stores only its path, digest and check results.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Codebase onboarding; label: MVP

## REQ-ONB-3
- source: /Users/aphan/avarice/docs/requirements.md
- description: During discovery and mapping, source code and existing project configuration must be read-only on every exposed mutation path. Generated onboarding artifacts may be written only to the approved staging location.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Codebase onboarding; label: MVP

## REQ-ONB-4
- source: /Users/aphan/avarice/docs/requirements.md
- description: Passive onboarding must not execute repository commands, install dependencies, run lifecycle scripts, start services, run migrations or reach production resources. Reading a script never authorizes running it.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Codebase onboarding; label: MVP

## REQ-ONB-5
- source: /Users/aphan/avarice/docs/requirements.md
- description: Committing generated artifacts must be disabled unless the onboarding contract or policy separately authorizes it.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Codebase onboarding; label: MVP

## REQ-ONB-6
- source: /Users/aphan/avarice/docs/requirements.md
- description: Existing GSD artifacts, existing AVARICE profiles, user edits to planning files and uncommitted source changes must never be silently overwritten. Provenance and source revision are reconciled first, and the outcome is adoption, refresh, migration, isolated regeneration or a recorded decision.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Codebase onboarding; label: MVP

## REQ-ONB-7
- source: /Users/aphan/avarice/docs/requirements.md
- description: Every accepted GSD artifact must be recorded with its source revision, mapping scope, mapping mode and completeness. A fast or path-scoped map must be labeled partial and must not be presented as whole-repository coverage.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Codebase onboarding; label: MVP

## REQ-ONB-8
- source: /Users/aphan/avarice/docs/requirements.md
- description: Mapping must run under an onboarding contract with path scope, file and byte limits where supported, wall-clock, tool-call, invocation and cost budgets, subagent limits and retry limits. Budgets persist across retries and restarts.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Codebase onboarding; label: MVP

## REQ-ONB-9
- source: /Users/aphan/avarice/docs/requirements.md
- description: Activation must produce a versioned project profile that references GSD artifacts and records operational policy. Repository instructions and GSD output may propose profile values but cannot grant permissions; activation validates the profile against higher-priority policy.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Codebase onboarding; label: MVP

## REQ-ONB-10
- source: /Users/aphan/avarice/docs/requirements.md
- description: Discovered setup, build, lint and test commands must stay inactive until a separate active-validation stage classifies and runs each one in an isolated, sandboxed workspace. Unexpected writes or network access fail validation.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Codebase onboarding; label: MVP (declared check commands), Later (setup and run commands)

## REQ-ONB-11
- source: /Users/aphan/avarice/docs/requirements.md
- description: Refresh must use revisions, changed paths and structural signals to choose between incremental refresh, path-scoped remapping and full remapping, and must not rescan the whole repository when the verified GSD version supports a narrower refresh.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Codebase onboarding; label: Contract

## REQ-ONB-12
- source: /Users/aphan/avarice/docs/requirements.md
- description: A missing enforcement layer, an incompatible GSD version or malformed artifacts must move onboarding to a blocking or restricted state, never to unrestricted execution.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Codebase onboarding; label: MVP

## REQ-ONB-13
- source: /Users/aphan/avarice/docs/requirements.md
- description: Onboarding must offer an index stage that builds GSD intel and the GSD-managed graph in the staging worktree under the onboarding contract, and must record each index's build commit and freshness in the project record. A failed index build must leave the record without that index, never block activation.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Codebase onboarding; label: MVP

## REQ-ONB-14
- source: /Users/aphan/avarice/docs/requirements.md
- description: Onboarding must offer a knowledge pass that adds document nodes to the graph for stable project documents: the codebase map, `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md` and the repository documents the contract lists. It must run as one contained invocation under the onboarding contract. Every document node must cite its source path and revision and be recorded as model-inferred. Its text is data and never grants authority (FR-14).
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Codebase onboarding; label: MVP

## REQ-ONB-15
- source: /Users/aphan/avarice/docs/requirements.md
- description: Refresh must re-extract only changed documents for the knowledge pass, and must add GSD phase files (`.planning/phases/**`, `STATE.md`) once incremental refresh exists.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Codebase onboarding; label: MVP

## REQ-NFR-1
- source: /Users/aphan/avarice/docs/requirements.md
- description: Baseline operation on one Mac must not need a NAS, cloud account, container runtime, Kubernetes, Redis or an always-on database server.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Portability; label: MVP

## REQ-NFR-2
- source: /Users/aphan/avarice/docs/requirements.md
- description: Local orchestration (status, resume planning, verification, checkpoints, evidence) must work without network access. [deployment-and-portability.md](deployment-and-portability.md#offline-matrix) lists exactly what remains usable.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Portability; label: MVP

## REQ-NFR-3
- source: /Users/aphan/avarice/docs/requirements.md
- description: Domain workflow code must not contain provider identifiers, URLs, absolute paths, SQL dialect or agent-vendor APIs. A lint check enforces the import boundary.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Portability; label: MVP

## REQ-NFR-4
- source: /Users/aphan/avarice/docs/requirements.md
- description: Moving artifact storage or execution to another host must need only configuration, explicit data migration, and possibly a new adapter. Domain workflow code must not change.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Portability; label: Contract (proved with a fake remote adapter), Later (real)

## REQ-NFR-5
- source: /Users/aphan/avarice/docs/requirements.md
- description: SQLite databases must live on local storage and must never be placed on a network filesystem.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Portability; label: MVP

## REQ-NFR-6
- source: /Users/aphan/avarice/docs/requirements.md
- description: After a process crash, sleep, or kill at any point, the next command must detect interrupted work and present a consistent state. That state can be "paused, needs reconciliation"; it must never silently be "done".
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Reliability; label: MVP

## REQ-NFR-7
- source: /Users/aphan/avarice/docs/requirements.md
- description: Every external side effect must carry an idempotency or correlation key. An ambiguous timeout must trigger reconciliation (look up by key) before any retry.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Reliability; label: Contract

## REQ-NFR-8
- source: /Users/aphan/avarice/docs/requirements.md
- description: Every critical operation must have a defined timeout, cancellation behavior and retry eligibility ([operations-and-testing.md](operations-and-testing.md#operation-budgets)).
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Reliability; label: MVP

## REQ-NFR-9
- source: /Users/aphan/avarice/docs/requirements.md
- description: Schema changes must be versioned, forward-only and tested against fixtures. An interrupted migration must leave either the old or the new schema, never a mix.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Reliability; label: MVP

## REQ-SEC-1
- source: /Users/aphan/avarice/docs/requirements.md
- description: Profiles (`personal-local`, `personal-extended`, `enterprise-<org>`) must have separate configuration, credential references, caches, logs, indexes, databases and artifacts. There must be no automatic fallback across profiles.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Security and isolation; label: MVP

## REQ-SEC-2
- source: /Users/aphan/avarice/docs/requirements.md
- description: Credentials must be resolved by reference at the moment of use, from an approved provider ([ADR-009](decisions/ADR-009-credential-broker.md)). An environment variable is not a provider. Tokens must never be written to prompts, state, evidence, artifacts or logs.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Security and isolation; label: MVP

## REQ-SEC-3
- source: /Users/aphan/avarice/docs/requirements.md
- description: Events and logs must pass through a redactor before persistence. Full tool payloads must not be retained by default.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Security and isolation; label: MVP

## REQ-SEC-4
- source: /Users/aphan/avarice/docs/requirements.md
- description: Enterprise policy must outrank repository and user settings. A repository file must not be able to loosen an organization rule.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Security and isolation; label: MVP (model), Onboarding (sources)

## REQ-SEC-5
- source: /Users/aphan/avarice/docs/requirements.md
- description: AVARICE must never disable TLS verification, weaken authentication, create an alternate egress path, or substitute an unapproved service to make an adapter work.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Security and isolation; label: MVP

## REQ-SEC-6
- source: /Users/aphan/avarice/docs/requirements.md
- description: Every control must be documented with its enforcer (host, external platform or AVARICE) and its bypass limitations.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Security and isolation; label: MVP

## REQ-SEC-7
- source: /Users/aphan/avarice/docs/requirements.md
- description: Employer-specific configuration and data must stay outside the personal framework distribution and repository.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Security and isolation; label: MVP

## REQ-SEC-8
- source: /Users/aphan/avarice/docs/requirements.md
- description: Every credential resolution attempt must be recorded as an event with the reference, purpose, calling module, profile, run and invocation IDs, outcome and duration. The event must never contain the value, its length or a digest of it.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Security and isolation; label: MVP

## REQ-OPS-1
- source: /Users/aphan/avarice/docs/requirements.md
- description: A `doctor` command must report configuration, versions, capabilities and dependency health without revealing secrets, and must work offline.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Operability; label: MVP

## REQ-OPS-2
- source: /Users/aphan/avarice/docs/requirements.md
- description: Structured events must carry the correlation IDs in [contracts-and-state.md](contracts-and-state.md#correlation-identifiers).
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Operability; label: MVP

## REQ-OPS-3
- source: /Users/aphan/avarice/docs/requirements.md
- description: AVARICE must provide backup, restore, export, import and uninstall commands with documented behavior.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Operability; label: MVP (backup, export, uninstall), Later (restore across hosts)

## REQ-OPS-4
- source: /Users/aphan/avarice/docs/requirements.md
- description: Retention limits must apply to events, evidence payloads and artifacts, configurable per profile.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Operability; label: MVP

## REQ-OPS-5
- source: /Users/aphan/avarice/docs/requirements.md
- description: The resource bounds (concurrency, context budget, artifact quota, queue length) must be configurable and enforced, with defined degradation when a bound is reached.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Operability; label: MVP

## REQ-OPS-6
- source: /Users/aphan/avarice/docs/requirements.md
- description: Upgrading GSD, the agent host or AVARICE must be detectable by `doctor`. Incompatible versions must fail with an actionable message, not partial behavior.
- acceptance: absent in source (no per-requirement criteria stated)
- scope: Operability; label: MVP

## REQ-AC-1
- source: /Users/aphan/avarice/docs/requirements.md
- description: Time from `install` to a first successful `status` on a fresh Mac with Node already present
- acceptance: under 10 minutes, no admin rights
- scope: Measurable acceptance criteria (measurable acceptance criterion)

## REQ-AC-2
- source: /Users/aphan/avarice/docs/requirements.md
- description: `status` latency with 1,000 runs in the store, warm cache
- acceptance: p95 under 300 ms
- scope: Measurable acceptance criteria (measurable acceptance criterion)

## REQ-AC-3
- source: /Users/aphan/avarice/docs/requirements.md
- description: Recovery after a forced kill during verification: the next `resume` identifies the interrupted attempt and offers re-verification
- acceptance: 100% of fault-injection cases in the recovery suite
- scope: Measurable acceptance criteria (measurable acceptance criterion)

## REQ-AC-4
- source: /Users/aphan/avarice/docs/requirements.md
- description: Duplicate privileged action after an injected ambiguous timeout
- acceptance: 0 duplicates in the reconciliation suite
- scope: Measurable acceptance criteria (measurable acceptance criterion)

## REQ-AC-5
- source: /Users/aphan/avarice/docs/requirements.md
- description: Secret patterns found in events, evidence or artifacts after the redaction suite
- acceptance: 0
- scope: Measurable acceptance criteria (measurable acceptance criterion)

## REQ-AC-6
- source: /Users/aphan/avarice/docs/requirements.md
- description: Cross-profile reads in the isolation suite
- acceptance: 0
- scope: Measurable acceptance criteria (measurable acceptance criterion)

## REQ-AC-7
- source: /Users/aphan/avarice/docs/requirements.md
- description: Domain-code changes needed to run the portability proof against the fake remote adapter
- acceptance: 0 lines
- scope: Measurable acceptance criteria (measurable acceptance criterion)

## REQ-AC-8
- source: /Users/aphan/avarice/docs/requirements.md
- description: Context retrieval quality on the evaluation set
- acceptance: task success rate with the context pack, index adapters present, at least equal to a full-repo baseline at no more than 50% of its tokens
- scope: Measurable acceptance criteria (measurable acceptance criterion)

## REQ-AC-9
- source: /Users/aphan/avarice/docs/requirements.md
- description: Routine low-risk tasks in the benchmark that reach `ready_for_review` with no phase-transition prompt
- acceptance: at least 70%, with defect rate no worse than attended runs of the same tasks
- scope: Measurable acceptance criteria (measurable acceptance criterion)

## REQ-AC-10
- source: /Users/aphan/avarice/docs/requirements.md
- description: Unnecessary escalations (a reviewer judges the answer was available in code, docs or an authorized default)
- acceptance: under 15% of escalations
- scope: Measurable acceptance criteria (measurable acceptance criterion)

## REQ-AC-11
- source: /Users/aphan/avarice/docs/requirements.md
- description: Containment failures (a write, read, command or endpoint outside the contract that succeeded on a path listed as prevented)
- acceptance: 0 in the containment suite and in benchmark runs
- scope: Measurable acceptance criteria (measurable acceptance criterion)

## REQ-AC-12
- source: /Users/aphan/avarice/docs/requirements.md
- description: Budget overruns beyond the declared tolerance of each budget
- acceptance: 0 for hard budgets; reported per run for estimated budgets
- scope: Measurable acceptance criteria (measurable acceptance criterion)

## REQ-AC-13
- source: /Users/aphan/avarice/docs/requirements.md
- description: Mechanical mutants on changed lines killed in benchmark runs with the mutation gate on
- acceptance: at least 90% killed or accepted as equivalent; 0 `NO-RUN` verdicts scored as survivors
- scope: Measurable acceptance criteria (measurable acceptance criterion)

## REQ-AC-14
- source: /Users/aphan/avarice/docs/requirements.md
- description: Brownfield benchmark repositories (5, varied stacks) that reach an active profile with no source change and no unapproved write outside the staging location
- acceptance: 5 of 5; 0 containment failures
- scope: Measurable acceptance criteria (measurable acceptance criterion)

## REQ-AC-15
- source: /Users/aphan/avarice/docs/requirements.md
- description: `avarice dashboard` render time with 1,000 runs in the store
- acceptance: under 2 seconds
- scope: Measurable acceptance criteria (measurable acceptance criterion)

## REQ-A-1
- source: /Users/aphan/avarice/docs/requirements.md
- description: Claude Code is the primary agent host. Other hosts that GSD supports are secondary.
- acceptance: absent (assumption; settled by: Confirmed by the user 2026-11-01)
- scope: Assumptions (provisional)

## REQ-A-2
- source: /Users/aphan/avarice/docs/requirements.md
- description: GSD 1.17.0 is the baseline version. GSD updates are taken deliberately, not automatically.
- acceptance: absent (assumption; settled by: Confirmed by the user 2026-11-01; GSD release cadence)
- scope: Assumptions (provisional)

## REQ-A-3
- source: /Users/aphan/avarice/docs/requirements.md
- description: GitHub (github.com) is the personal SCM and CI. `gh` 2.100.0 is installed.
- acceptance: absent (assumption; settled by: User confirmation)
- scope: Assumptions (provisional)

## REQ-A-4
- source: /Users/aphan/avarice/docs/requirements.md
- description: Personal tasks start as manual briefs. No personal tracker integration is needed for the MVP.
- acceptance: absent (assumption; settled by: User confirmation)
- scope: Assumptions (provisional)

## REQ-A-5
- source: /Users/aphan/avarice/docs/requirements.md
- description: The future NAS can run a small long-lived process (container or native) and is reachable over a private network or VPN.
- acceptance: absent (assumption; settled by: NAS model and OS)
- scope: Assumptions (provisional)

## REQ-A-6
- source: /Users/aphan/avarice/docs/requirements.md
- description: The employer's tracker, SCM, CI, identity provider, approved models and audit sink are unknown.
- acceptance: absent (assumption; settled by: Enterprise onboarding questionnaire)
- scope: Assumptions (provisional)

## REQ-A-7
- source: /Users/aphan/avarice/docs/requirements.md
- description: Node.js 22.13 or newer is acceptable as the only runtime dependency, because GSD already requires Node.
- acceptance: absent (assumption; settled by: [ADR-001](decisions/ADR-001-language-and-runtime.md) revisit trigger)
- scope: Assumptions (provisional)

## REQ-A-8
- source: /Users/aphan/avarice/docs/requirements.md
- description: Unattended runs execute on the Mac while it is awake and on power. A sleeping Mac stops computing; continuing during sleep needs the later remote worker.
- acceptance: absent (assumption; settled by: User confirmation)
- scope: Assumptions (provisional)

## REQ-A-9
- source: /Users/aphan/avarice/docs/requirements.md
- description: Model usage is billed per token through the host, and the host reports usage only at the end of each headless invocation, so per-invocation limits are the enforceable budget unit.
- acceptance: absent (assumption; settled by: Host research in [containment.md](containment.md#budgets-and-usage-visibility))
- scope: Assumptions (provisional)

## REQ-A-10
- source: /Users/aphan/avarice/docs/requirements.md
- description: Onboarding targets one Git repository at a time on local storage; monorepos are handled by path scope inside that repository.
- acceptance: absent (assumption; settled by: Survey of the user's own repositories)
- scope: Assumptions (provisional)
