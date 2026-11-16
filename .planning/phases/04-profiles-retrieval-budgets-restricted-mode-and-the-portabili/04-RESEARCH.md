# Phase 4: Profiles, retrieval budgets, restricted mode and the portability proof - Research

**Researched:** 2026-11-15
**Domain:** TypeScript (Node 22.22.3+, native type stripping, `node:test`, `node:sqlite`) service layer around Claude Code and GSD: profile isolation, credential broker, redaction, parameter-bound approvals, handle-first retrieval, restricted mode, `doctor`, brownfield adoption and refresh, fake-remote portability proof
**Confidence:** HIGH for in-repo structure and seams (read this session); MEDIUM for benchmark cost and token-metric design; LOW for the three items in the Assumptions Log marked as spikes

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** One phase, one PR, grouped into five workstreams with waves by dependency. Phase 4 stays one phase on this branch (memory rule: one PR per phase). Its plans fall into five workstreams: (A) profiles, credentials, redaction and isolation; (B) ports, capability requirements and the `Unsupported` path; (C) approvals and policy, restricted mode and `doctor`; (D) brownfield adoption, refresh and promotion; (E) retrieval, including the edge-mapping spike and the three-arm evaluation. The fake-remote portability proof and the documentation pass come last. The phase is not split into decimal sub-phases.
- **D-02:** Foundations first. Wave order: A and B first, because everything else reads profile config and capability descriptors; then C; then D; then E; then the fake-remote proof (AC-7); then documentation. The planner refines this by dependency.
- **D-03:** The live-model spend ceiling for Phase 4 is 40 USD, enforced mechanically as in Phase 2 D-15 and Phase 3 D-05. A separate Phase 4 ledger holds it, and an environment variable can only lower it. Execution stops and asks the owner before exceeding it. Rough allocation: three-arm eval about 24, five AC-14 onboardings with the knowledge pass about 8, live containment cases (restricted mode, approvals, host admission) about 8.
- **D-04:** Phase 3's exit discipline carries over (Phase 3 D-26 to D-39). Every unexpected live stop is classified, with evidence, as a product defect or a brief/harness defect. Claude proposes the classification and the owner rules on it at a checkpoint. Live work stops after 2 failures of the same exit item within an epoch. A proven, owner-confirmed product-defect fix starts a new epoch. Offline suites run before live cases, and live cases run before benchmark runs (Phase 2 D-07).
- **D-05:** AC-14 benchmark set: 5 brownfield repositories mixing the owner's own repositories and pinned public open-source repositories. It includes `~/aa-phan-portfolio-v2`, up to one or two more of the owner's repositories, and public repositories at fixed commits, so the set covers varied stacks (for example Python, Go and Rust). At least one repository must already carry GSD artifacts (`.planning/`) so ONB-6 adoption is exercised. Claude drafts the list with stacks and commits, and the owner approves or swaps entries at a checkpoint before any live spend. Pass bar: 5 of 5 reach an active profile with no source change and 0 containment failures.
- **D-06:** The AC-8 baseline arm is the evaluation doc's definition: the GSD codebase map plus the files the agent finds itself (`docs/operations-and-testing.md:151`). The literal full repository is not the baseline. The conflict with the requirement's "full-repo baseline" wording (`docs/requirements.md:237`) goes to `docs/system/findings.md`.
- **D-07:** The three-arm evaluation uses 20 replayed historical commits. Claude mines them from the owner's repositories (the portfolio and the AC-14 set). For each task, the brief comes from the commit message, the base is the commit's parent, and success means the required checks pass and a held-out test taken from the commit passes. The owner approves the task list at a checkpoint before spend. "Reviewer judgment" becomes a sampled owner spot-check, not a gate. AC-8 passes when the index-adapter arm matches the baseline's task success at no more than 50% of its tokens.
- **D-08:** Knowledge-pass default rule: the knowledge pass stays on unless the with-knowledge arm shows no task-success gain over code-only and also costs more tokens. The outcome is recorded as an ADR in `docs/decisions/` either way. Reversibility: reversible - a default in profile config.
- **D-09:** Retrieval caps start from the illustrative values in `docs/containment.md:173-187`. They become profile-configurable defaults (OPS-5) and are tuned only if the evaluation shows a cap causing task failures. The final values are recorded in `docs/system/config-reference.md`.
- **D-10:** ONB-6 adoption follows the spec. Implement classification and the outcomes adopt, refresh, migrate, isolated regeneration and recorded decision per `docs/repository-onboarding.md:266-290`, including adoption of a stamped map whose drift check passes. Unblock the `adopt` and `paths` mapping modes (`docs/repository-onboarding.md:167-181`) and populate `files.delete` per the Refresh rule. Isolated regeneration remains the outcome for `unknown-format` and `user-edited` maps, and user edits are never overwritten. This replaces the blanket `EXISTING_MAP_OUTCOME = 'isolated-regeneration'` and the "until Phase 4" refusals in `src/domain/preflight.ts`. Close findings `docs/system/findings.md:45-47`.
- **D-11:** ONB-11 incremental graph refresh keeps AVARICE's own extract-and-merge pipeline, extracting only the changed paths. It does not use `graphify update .`. This keeps the slice 0 spike's choice and the built code. The deviation from `docs/repository-onboarding.md:313` is recorded in `findings.md`. ONB-15 knowledge refresh re-extracts only changed documents and adds `.planning/phases/**` and `STATE.md` (S-47).
- **D-12:** An unenforceable or unadmitted host still refuses by default, with a message naming `--restricted`. Restricted mode runs only on that explicit opt-in. It works on a disposable copy with no network and no writes outside it, its output is a plan, a patch and a decision list, and `status` labels the run `restricted` (`docs/containment.md:153-161`, S-22). Restricted onboarding produces a fast map labeled `partial (restricted)`. It never falls back to instructions or unrestricted execution (CON-4). Close finding `docs/system/findings.md:90`.
- **D-13:** The default context pack budget rises to 24,000 tokens (`docs/operations-and-testing.md:69`, `docs/contracts-and-state.md:887`) and is profile-configurable. The planner checks how this interacts with the run prompt-size limit (32 KiB, `docs/system/config-reference.md`) and records the resolution. `avarice context` keeps its `--budget` override.
- **D-14:** SEC-3: full tool payloads are not retained by default. By default a run keeps a redacted summary and a digest of each transcript. Whole redacted transcripts are kept only on an explicit profile or debug opt-in. Events and logs pass through the redactor before persistence, which means applying `src/domain/secret-patterns.ts` in `appendEventRow` and in log writes. The planner also addresses redaction running after the 20 MiB transcript cap (`docs/system/findings.md:75`).
- **D-15:** The promotion mode defaults to `none`, with `copy` and `commit` as explicit opt-ins (`docs/repository-onboarding.md:159-165`). This settles the open owner decision at `README.md:188`. Promotion never overwrites user edits or uncommitted source changes (ONB-6).
- **D-16:** Profile selection uses the repository binding plus `--profile`. `repo add --profile <name>` binds a repository. Commands on a bound repository use its profile, and other commands take `--profile` with `personal-local` as the default. An `AVARICE_PROFILE` environment variable may set the default but never overrides a binding. A mismatch refuses and reads neither store (S-9). A repository whose remote matches an enterprise pattern but is registered in a personal profile is refused (`docs/enterprise-adaptation.md:53-63`).
- **D-17:** `personal-extended` and `enterprise-<org>` are modeled, and tested with fixtures. `personal-extended` is a personal profile that allows extra credential providers and integrations (for example `delegated:gh` for Phase 5 PRs). `enterprise-<org>` is built and tested against a fixture organization package under `test/fixtures`. The tests cover policy precedence (organization, then built-in defaults, then user, then repository; lower ranks only add restrictions; an invalid rank-1 policy denies every privileged action), refusal by remote pattern, and managed-only rules. Nothing employer-specific enters the repository (SEC-7). Host limitation 4 (`allowManagedPermissionRulesOnly` semantics, `docs/containment.md:221`) stays documented as unverified, and no profile claims `enforced` for the rows it affects.
- **D-18:** Existing data stays in place as `personal-local`. The current layout already matches the per-profile roots. A ledger migration adds whatever profile scoping is needed, and existing records, including the portfolio's active record at `9f1cd8d`, belong to `personal-local` with an implicit binding. No owner-run migrate command. The migration fault tests cover it. Reversibility: costly - a ledger schema migration that the backup and restore work in Phase 5 will depend on.
- **D-19:** Fix the moved-root readability gap in this phase. A profile whose roots were moved by environment variable must not be readable by other profiles' runs (`docs/system/containment.md:468`). AC-6 requires 0 cross-profile reads.
- **D-20:** Host admission becomes a patch range inside a verified minor, guarded by a self-check at launch. `ADMITTED_CLAUDE_VERSIONS` (`src/adapters/host-claude/launch-preflight.ts:24`) is replaced by a rule that admits any patch at or above the lowest verified patch within a verified minor (today 2.1.312 and up on 2.1.x). An unverified patch must pass the offline preflight probes at launch: settings keys honored, the sandbox probe, and the hook's fail-closed self-test. `doctor` labels it `admitted (unverified patch)`. A new minor (for example 2.2) or a failed probe still refuses until a live T3 containment run passes on it. Each admission is recorded in `test/containment/LIVE-CASES.md`. The installed 2.1.321 is admitted under this rule only if its probes pass. Reversibility: reversible - one admission predicate. Its risk is a patch release that changes containment semantics without failing a probe, so the probes must cover every host behavior containment relies on.

Carried forward (not re-decided), verbatim from CONTEXT.md:
- ADR-009 credentials: `delegated:`, `keychain:` and `cmd:` references only. `env:` is refused in every profile and fails `doctor` (S-49). Every lookup writes a `credential.resolve` event with no value, length or digest, and a resolved value seeds the redactor.
- Approvals (ADR-005, `docs/contracts-and-state.md:816-836`): actions are classed `read`, `local-write` or `privileged`, in a table in code. An approval is single-use, bound to the run, action and parameter digest, expires after 30 minutes by default, and is consumed in the transaction that starts the action. A contract that authorizes an action with its parameters is a valid source. Approving a plan approves no actions. Queued privileged actions never replay automatically (FR-15). The existing `approvals` table (`migrations/0001-initial.ts:76`) is the store.
- Retrieval (`docs/contracts-and-state.md:327-354`, `docs/containment.md:173-187`): `find` returns handles first, the assembler chooses within budget, and every pack lists what it omitted. Broad discovery needs `broadDiscovery: true` and is allowed once per run. Edge read rules come from a configuration table that the graphify relation spike fills, and an unmapped relation defaults to `id-only`. Caches record version, scope and profile, and are not reused after `denied` or `unauthenticated`.
- `doctor` (`docs/operations-and-testing.md:9-25`, `docs/extensions.md:379-408`): works offline, finishes in under 2 s, has `--json`, `--online` and `--repair`, prints no secrets, and reports the enforcement level `enforced`, `restricted` or `none`. After a GSD upgrade outside the adapter range, records are marked `incompatible` (S-38).
- Fake remote (`docs/operations-and-testing.md:155-157`, `docs/deployment-and-portability.md:140-150`): the `CommandExecutor` and `ArtifactStore` fakes serialize every call through JSON, add latency, drop 5% of responses and duplicate 2%. Both suites run the same compiled bundle. Domain code changes by 0 lines.
- Prior phases: `--json` shapes stay frozen, with optional keys appended only (Phase 2 D-19). The profile config holds user settings and a contract may only narrow them (Phase 3 D-21). Claude drafts exit inputs and the owner approves them before spend.
- Documentation: the phase's last plan is the `docs/system/` pass required by `CLAUDE.md` and SC6. It records every spec deviation decided here in `findings.md`: AC-8 baseline wording, `graphify update`, and the context budget and transcript resolutions if they deviate. Proposal docs are not edited to match the code. D-08's knowledge-pass outcome and D-20's admission rule each get an ADR.

### Claude's Discretion

- How each workstream splits into plans and waves, within D-01 and D-02.
- The action classification table's contents, and the approval command's user experience (a CLI command following the `decide` and `amend` identity rules, Phase 3 D-14 and D-18).
- `doctor` output layout, exit codes and `--repair` scope, within the docs.
- The graphify relation-to-edge-rule mapping, from the spike.
- The full-remap drift threshold value (`docs/repository-onboarding.md:177`). The docs give none, so pick it and record it.
- Which ports beyond `CommandExecutor` and `ArtifactStore` get fake-remote coverage, and the shape of the contract-suite package.
- The exact OPS-5 bound keys in profile config and how each bound degrades.
- Whether boundary lint extends to adapter-to-adapter isolation.
- Manual-equivalent commands per integration (`docs/enterprise-adaptation.md:134-146`).

### Deferred Ideas (OUT OF SCOPE)

None. The discussion stayed within phase scope. The v1.0 tech-debt items not pulled in by D-14 and D-19 stay in Phase 9.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ONB-6 | Existing GSD artifacts, AVARICE profiles, user edits and uncommitted source changes never silently overwritten; adopt, refresh, migrate, isolated regeneration or recorded decision | `classifyExistingMap` already yields six classes; outcome is hard-coded (`src/domain/preflight.ts:52`); `adopt` and `paths` are blocked in `chooseMappingMode`; three owner repos carry `.planning/codebase` maps (Wave D) |
| ONB-11 | Refresh chooses incremental, path-scoped or full remap from revisions, changed paths, structural signals | GSD `verify codebase-drift` (default threshold 3, `drift.cjs:202-204`); `checkDrift` adapter method exists; no refresh stage or entry point yet; preflight refuses an active record |
| ONB-15 | Knowledge refresh re-extracts only changed documents; adds `.planning/phases/**` and `STATE.md` | Knowledge manifest artifact holds per-document identity; merge code in `src/domain/graph-merge.ts`; S-47 |
| FR-3 | Bounded, cited context pack with source identity, revision, retrieval time, scope | `PackItem`/`ExternalRef` already carry these; budget and omissions exist; needs 24k default, profile bound, caps |
| FR-8 | On resume every external reference refreshed or marked stale | `task_refs` has no writer; `ContextSource` lacks the spec's `refresh`; blocked reasons `ref_changed`, `ref_deleted`, `access_revoked` exist in `RUN_BLOCKED_REASONS` but nothing sets them |
| FR-12 | Actions classed read, local-write, privileged; privileged need a bound approval; contract is a valid source | `approvals` table has no writer or reader; no classification table; promotion `copy`/`commit` is the first in-phase privileged caller |
| FR-13 | Planning permission is not action permission | No "approve plan" gate exists; assert by test that `decide` answers never write `approvals` rows |
| FR-14 | Retrieved content grants no authority | S-46 fencing exists in `src/app/context.ts`; add policy-source whitelist and negative tests |
| FR-15 | Queued privileged actions never replay | No privileged action exists before Phase 5; build the gate and test it with a synthetic action |
| FR-16 | Ports declare capabilities; unsupported returns typed `Unsupported` | `PortError` has `unsupported{capability, reducedMode}`; descriptors exist; no composition-time requirement check |
| FR-17 | Provider features via namespaced extensions | `CapabilityDescriptor.extensions?` exists, unused |
| FR-18 | External references keep provider IDs | `ExternalRef.id` is verbatim today; add a guard test |
| FR-19 | Manual equivalent for every integration | None of `context add`, `evidence add`, `pr record`, `comment --print`, `approve` exists |
| FR-22 | Handle-first retrieval, rule per edge type | `readRule: 'one-hop'` is hard-coded for every graph node (`src/adapters/context/gsd-graph.ts:119`); relation vocabulary observed from a real graph below |
| SEC-1 | Separate profiles, no fallback | `DEFAULT_PROFILE` hard-coded (`profile-paths.ts:27`); `--profile` accepted only as `personal-local` (`init.ts`); `meta.profile_id` written, never read |
| SEC-2 | Credentials by reference from an approved provider; env is not a provider | No `CredentialProvider` port; `unauthenticated` error never produced |
| SEC-3 | Events and logs redacted before persistence; no full payloads by default | `appendEventRow` stores `data_json` unredacted; transcript stored redacted after cap |
| SEC-4 | Enterprise policy outranks repository and user | No policy module; profile policy is the constant `ROUTINE_PRESET`/`policy-narrowing.ts` |
| SEC-6 | Every control documented with enforcer and bypass limits | Enforcement map exists as prose in `docs/enterprise-adaptation.md`; no code table or test |
| SEC-7 | Employer config outside the distribution | Fixture org package under `test/fixtures` plus a guard test |
| CON-4 | Unenforceable host runs only in explicit restricted mode | `claude --restricted` exists on the installed 2.1.325; no `--restricted` flag or mode in AVARICE |
| CON-10 | Progressive retrieval; broad discovery authorized | No `retrieval` keys in `ROUTINE_PRESET`; no `broadDiscovery` anywhere in `src` |
| CON-11 | Retrieval adapters enforce scope, field, page, result, byte, timeout, cancel, cumulative caps | Local adapters only; fake remote proves the shape |
| CON-12 | Caches record version/scope/profile; not reused after revoke or across profiles | `ExternalRef` has revision/scope; no profile or revoke handling |
| OPS-1 | `doctor`: config, versions, capabilities, dependency health; offline; no secrets | No `doctor` command (`COMMANDS` has 15 names, none `doctor`) |
| OPS-5 | Resource bounds configurable and enforced with defined degradation | Constants scattered (`PACK_BUDGET`, `RUN_PROMPT_MAX_BYTES`, quotas absent); profile config parsed only for `notify` |
| OPS-6 | Upgrade of GSD, host or AVARICE detectable by `doctor`; incompatible fails actionably | Version checks scattered (host allowlist, `locateGsdCore`, graphify version never compared, Node never checked) |
| NFR-4 | Moving storage or execution needs only config, data migration, maybe an adapter | Fake-remote `CommandExecutor` and `ArtifactStore` plus shared contract suite; ArtifactStore port is synchronous |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Documentation, living tree:** `docs/system/` exists in this checkout, so the rules apply. Any change that alters behavior, adds a command, flag, config key, table, event or external integration, or changes an exit code updates the matching `docs/system/` document in the same change. A new subsystem gets its own `docs/system/` document written from the code, listed in `docs/system/README.md` (documents table and proposal counterparts table) and `docs/system/coverage.md`; update `coverage.md` when a recorded count changes.
- **Documentation, proposals:** `docs/` outside `docs/system/` (requirements, architecture, ADRs) is the proposal that unbuilt work is planned from. Do not edit it to match the code. Change it only when a design decision changes, and record the decision. An accepted ADR is never rewritten; supersede it with a new one. Code-versus-proposal disagreements go to `docs/system/findings.md` as one line with `file:line`.
- **Final plan:** every phase ends with a documentation plan that depends on all others. It compares the diff with `docs/system/`, updates or writes documents (per `technical-writer:documenting-legacy-codebases`), updates the README tables, `coverage.md`, `findings.md`, and has each new or changed document reviewed by a fresh `technical-writer:prose-reviewer` before it is marked reviewed in `coverage.md`. Load `technical-writer:technical-writing` for the prose. `docs/system/` documents name modules once in the opening and keep file paths, function names and delivery history (phase numbers, plan IDs, threat IDs) out of the prose.
- **Merging:** work reaches `main` only through a pull request merged with a merge commit (`gh pr merge --merge`). Never commit or push to `main`, never merge locally. Delete the branch afterwards.
- **Memory:** one PR per phase; no PR for context or plans alone.
- **No `.planning/config.json` exists in this checkout.** Both `workflow.nyquist_validation` and `security_enforcement` are absent, so both sections below are included.

## Summary

Phase 4 touches almost every layer built in Phases 1 to 3, but it adds no dependency: the whole codebase is TypeScript run directly by Node with `node:test`, and `test/unit/footprint.test.ts` enforces "no runtime dependencies, devDependencies pinned exactly". Every capability here (profile resolver, credential broker, redactor, policy evaluator, approvals, retrieval guard, `doctor`, adoption and refresh, fake remote adapters) is in-repo code behind the existing layer rules (`domain` pure, `ports`, `app`, `adapters`, `cli`, import lint in `scripts/check-boundaries.ts`). The design pattern that makes the phase tractable is the one Phases 1 to 3 already use: a pure domain table or rule, a ledger or adapter that enforces it inside one transaction, a CLI command that follows the owner-terminal identity rule, and a fault or integration test that proves the refusal.

Three findings change the plan and need attention before waves are cut. First, **AC-2 fails today**: I cloned the real run rows of the owner's store until it held 1,016 runs and `avarice status --json` took a median of 924 ms against 129 ms for an empty store (about 795 ms of work), versus the 300 ms p95 target (adding five missing `run_id` indexes alone brought it to 360 ms with no code change, so indexes are the largest lever but not enough); `getRunStatuses` runs nine queries per run (eleven for an interrupted one) and three of the touched tables (`decisions`, `gate_results`, `notifications`) have no `run_id` index. Second, **the D-03 spend ceiling does not fit the evaluation as designed**: a full AVARICE unit cost about 1.18 USD in the Phase 2 exit (3.5286 USD for three runs), and 3 arms x 20 tasks is 60 runs, which would be about 70 USD against the 24 USD allocation. The evaluation needs a lean harness (small model, per-run cap near 0.40 USD) and a pilot that measures real cost per arm before the owner approves spend. Third, **D-13's 24,000-token pack cannot fit the 32 KiB prompt cap** (`RUN_PROMPT_MAX_BYTES`): 24,000 tokens is about 96,000 characters. The run prompt already cuts only the pack to fit, so the effective pack is at most about 8,000 tokens (32 KiB divided by 4) and less once the contract text is subtracted; the resolution has to be recorded, not assumed.

The remaining risks are structural: `--profile` has to be threaded through `main()`, `createDeps`, the detached supervisor environment and the launchd environment list before the store is opened (S-9 requires reading neither store on a mismatch); the `ArtifactStore` port is synchronous, so a fake remote must add latency with `Atomics.wait` and must hide drops and duplicates inside the adapter (retry by digest or by `invocationId`) or AC-7 would force domain changes; `doctor` must not use the normal composition path, which exits 70 on any store, profile or GSD problem; and `D-20`'s "settings keys honored" probe cannot be proven offline, because launch preflight today checks only that the generated settings file contains the keys.

**Primary recommendation:** Plan 36 plans in eight waves (Wave 0 spikes and owner checkpoints, A+B foundations, C, D, E, fake-remote proof, live spend, documentation), keep one PR per D-01, build every new capability as pure domain rule plus ledger-enforced adapter plus fault/integration suite, fix AC-2 early with batched status queries and a `0004` migration of indexes, and treat the evaluation harness and the AC-14 run as owner-gated live plans that start only after offline suites are green and a cost pilot has been read.

## Architectural Responsibility Map

The tiers here are the layers of this codebase and the enforcers named in `docs/enterprise-adaptation.md` (the "Enforcement map"), not web tiers.

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Profile selection, repository binding | `cli` + composition (before the store opens) | `adapters/fs` (binding registry file in the config home) | S-9 needs the decision before any store is read; the binding must live outside every store |
| Profile config parse (limits, adapters, retrieval caps, credential refs) | `domain` (pure parser, like `parseProfileNotify`) | `adapters/fs` (reads the file, `O_NOFOLLOW`, 64 KiB cap) | Contract may only narrow user settings (Phase 3 D-21), so the parser is a domain rule |
| Credential reference grammar, `env:` refusal | `domain` | `adapters` (keychain, cmd, delegated) behind a `CredentialProvider` port | ADR-009: broker, no stored secret |
| Redaction | `domain` (`Redactor`: patterns plus seeded literals) | ledger adapter, artifact decorator, host adapter (apply it) | One redactor, applied at each persistence boundary |
| Action classification, policy precedence, approval matching | `domain` (pure tables and evaluator) | `adapters/sqlite` (single-use consume in one transaction), `hook` (host-side check) | ADR-005: evaluator is code, rule sources are pluggable |
| Approval command | `cli` (owner-terminal identity) | `app` (`authorizeAction` gate) | Reuses `decide`/`amend` identity rules |
| Retrieval caps and edge rules | `domain` (cap table, relation to rule table) | `app/context.ts` (assembler), source adapters (enforce), ledger budget rows (exact counters) | CON-11: adapters enforce; counters survive restarts |
| Restricted mode | composition (host choice) + `adapters/host-claude` (`--restricted` launch) | `adapters/git` (disposable copy) | Host choice is a composition concern; containment of file tools is the host's (`--restricted` confines file tools) |
| `doctor` | `app` read model over injected probes | `adapters` (version, sandbox, store probes), `cli` | App cannot import adapters; probes arrive through a port |
| Adoption, refresh, promotion | `domain` (classification, refresh planner) | `app/stages`, `adapters/gsd`, ledger | Pure rule decides, stage executes |
| Fake-remote executor and artifact store | `test/helpers` + composition seam | none in `src/domain`, `src/app` | AC-7: zero domain change; the seam is configuration |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | `>=22.22.3` in `package.json` (`engines`); dev machine runs v26.9.0 | Runtime, native TS type stripping, `node:test`, `node:sqlite` | Project baseline (ADR-001); no build step |
| TypeScript | 7.0.2 (devDependency, `typecheck` script) | Type checking only | Pinned exactly, enforced by `footprint.test.ts` |
| `node:test` | built in | All tiers | No test dependency exists |
| `node:sqlite` | built in | Ledger | WAL-reset gate in `src/adapters/sqlite/db.ts` |

### Supporting (external tools the phase drives, all already integrated)

| Tool | Version found | Purpose | When to Use |
|------|---------------|---------|-------------|
| Claude Code | 2.1.325 installed this session (CONTEXT says 2.1.321; the admitted list ends at 2.1.319) | Contained host; `--restricted` exists on this version | D-20 admission, restricted mode, live cases |
| GSD (`@opengsd/gsd-core`) | 1.17.0 at `~/.claude/gsd-core` | Map, drift (`verify codebase-drift`), intel, graph reader | Adoption, refresh, retrieval |
| graphify | 0.9.53 | Code graph extraction | Incremental refresh, edge relations |
| git | 2.39.5 (Apple Git) | Preflight, workspaces, disposable copy | Everywhere (through `runGit`) |
| `sandbox-exec` | `/usr/bin/sandbox-exec` present | OS sandbox | Launch checks, test offline wrapper |
| `security` | `/usr/bin/security` present | macOS Keychain lookups for `keychain:` references | Credential adapter |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-written validators | A schema library (zod, ajv) | Rejected by NFR-1 and the footprint test; the codebase parses untrusted JSON by hand (`parseProfileNotify`, `parseHookPolicy`) |
| `keytar`/`node-keychain` | `/usr/bin/security` through the sandboxed executor or `runGit`-style safe spawn | A native module breaks "nothing to install"; ADR-009 names `security find-generic-password` |
| OPA or another policy engine | Pure `evaluate()` over sources | ADR-005 "Policy as an adapter port" is a rejected alternative |
| `graphify update .` for incremental refresh | AVARICE extract-and-merge restricted to changed paths | D-11 locks the latter; `update` writes into the tree and indexes Markdown (`src/adapters/graph/graphify.ts:6-7`) |

**Installation:** none. Phase 4 installs no package.

**Version verification:** `package.json` read this session (`devDependencies`: `@types/node` 22.20.5, `typescript` 7.0.2); `claude --version` 2.1.325, `graphify --version` 0.9.53, `node ~/.claude/gsd-core/bin/gsd-tools.cjs runtime-identity --raw` printed `{"packageName":"@opengsd/gsd-core","version":"1.17.0"}`, Node v26.9.0, git 2.39.5 (all run this session).

## Package Legitimacy Audit

No external package is installed or recommended by this phase, so the gate has nothing to evaluate.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| none | none | n/a | n/a | n/a | n/a | n/a |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

The shared "contract suite package" of the slice deliverables is an in-repo directory (recommended `test/contract/`), not an npm package. If a plan proposes a dependency, `test/unit/footprint.test.ts` fails the build, which is the intended control.

## Architecture Patterns

### System Architecture Diagram

```
                 avarice <cmd> [--profile P] [--restricted]
                                   |
              +--------------------v---------------------+
              | main.ts: parseArgs -> usage() checks       |
              | selectProfile(flag, binding, AVARICE_PROFILE, default)   <-- NEW, before any store
              +--------------------+---------------------+
                  mismatch -> exit 3, no store read (S-9)
                                   |
              +--------------------v---------------------+
              | composition (createDeps / createDoctorDeps) |
              |  resolveProfile(P) -> roots, config.json  |
              |  adapter registry (config-selected)        |
              |  capability requirements check -> Unsupported(reducedMode)
              |  host: enforced | restricted(--restricted) | refuse (names --restricted)
              +----+----------+-----------+--------+------+
                   |          |           |        |
        +----------v--+  +----v-----+ +---v----+ +-v--------------+
        | app services|  | domain   | | ports  | | adapters       |
        | onboard/run |  | Redactor | | Ledger | | sqlite ledger  |
        | context     |  | policy   | | Cred.  | |  appendEventRow--> Redactor
        | doctor      |  | actions  | | Context| | fs artifacts (decorated: redact)
        | authorize   |  | edge rules| | Exec  | | host-claude (--restricted, transcript redact per line)
        | refresh     |  | refresh  | | Artifact| | gsd, graphify, git
        +------+------+  | planner  | +--------+ | credential: delegated | keychain | cmd
               |         +----------+            +--------+-------+
               |                                          |
   privileged action? --> authorizeAction(run, action, paramsDigest)
        contract authorizes with params? --yes--> allowed (event approval.contract)
        else approvals row match (run, action, digest, unexpired, unrevoked, unconsumed)
             --> consume + start in ONE transaction; else denied + `avarice approve <id>` hint
   retrieval: find() -> handles (no content) -> assembler picks within budget (24k default,
        prompt cap trims) -> read() -> pack + omitted list; guard counts searches/reads/bytes
        in budgets rows; broad discovery needs contract flag, once per run
   test seam: same suites run with fake-remote executor/artifact adapters (JSON, latency, 5% drop, 2% dup)
```

### Recommended Project Structure

New files only; names follow the existing kebab-case and tier layout.

```
src/domain/
  profile.ts              # profile names, classes, parseProfileConfig, selection precedence (pure)
  credential-ref.ts       # reference grammar; env: refused
  redactor.ts             # Redactor class over secret-patterns.ts + seeded literals
  action-class.ts         # action table: read | local-write | privileged
  policy.ts               # rank sources, evaluate(), invalid rank-1 => deny all privileged
  approval.ts             # parameter digest, expiry, match rules (pure)
  retrieval-rules.ts      # per-step caps, edge relation -> read rule table, broad discovery rule
  refresh-plan.ts         # drift + changed paths -> incremental | paths | full; drift threshold
  capability-requirements.ts  # step -> required capabilities -> Unsupported(reducedMode)
  enforcement-map.ts      # SEC-6 table: control, enforcer, bypass limitation
src/ports/
  credential-provider.ts  # resolve(ref, purpose)
  diagnostics.ts          # probes doctor needs (host version, sandbox, gsd, graphify, store)
src/app/
  authorize.ts            # authorizeAction: contract source, else approval; consume in a transaction
  doctor.ts               # read model over probes; findings with actionable text
  refresh.ts              # refresh stage selection, adoption outcomes
  resume-refs.ts          # FR-8: refresh or mark stale; ref_changed
src/adapters/
  credential/{delegated,keychain,cmd}.ts
  context/{git-files,gsd-planning}.ts      # the two adapters CONTEXT says are missing
  fs/profile-bindings.ts  # <configHome>/bindings.json, O_NOFOLLOW, 0600
  fs/profile-registry.ts  # other profiles' roots from <configHome>/profiles/*/config.json
src/cli/commands/
  doctor.ts approve.ts context-add.ts (or `context add` subcommand) evidence-add.ts pr-record.ts comment.ts
src/adapters/sqlite/migrations/0004-profiles.ts   # indexes for AC-2, approvals index, profile scoping
test/helpers/fake-remote-executor.ts, fake-remote-artifact-store.ts
test/contract/            # shared contract suite: same cases against local and fake-remote adapters
test/fixtures/org-acme/   # fixture organization package (policy.json, remote patterns)
docs/decisions/ADR-014-*.md (knowledge-pass default), ADR-015-*.md (host admission rule)
```

### Pattern 1: Pure rule plus single-transaction enforcement plus owner-terminal command

**What:** Everything that must hold under a crash is a domain function plus one ledger transaction; the command that grants authority refuses outside an interactive terminal outside a run.
**When to use:** approvals (consume at action start), approvals grant (`avarice approve`), promotion, profile binding writes.
**Example:**
```typescript
// Source: src/cli/identity.ts (read this session)
export function refuseOutsideTerminal(env: NodeJS.ProcessEnv, context: IdentityContext): string | undefined {
  if (env['AVARICE_RUN'] !== undefined) return 'refused inside a run (AVARICE_RUN is set)';
  if (!context.terminal.stdinIsTty || !context.terminal.stdoutIsTty) return 'needs an interactive terminal';
  if (inRunProcessTree(context.ancestry())) return "refused from inside a run's process tree";
  return undefined;
}
// A command calls this from usage(), before the profile is resolved, so a refusal reads no store.
```

### Pattern 2: Decide the profile before opening any store

**What:** Profile selection is a pure function of `(--profile flag, repository binding, AVARICE_PROFILE, default)` evaluated in `main()` before `createDeps`; the binding registry lives in the config home (outside every store), written by `repo add --profile`.
**When to use:** every command. A mismatch refuses with "repository bound to <profile>" and opens neither store (S-9).
**Example:**
```typescript
// Sketch, new code. Precedence per D-16: a binding is never overridden by AVARICE_PROFILE.
export function selectProfile(i: { flag?: string; bound?: string; envDefault?: string }): Result<string> {
  if (i.bound !== undefined && i.flag !== undefined && i.flag !== i.bound) {
    return err({ kind: 'denied', rule: `repository-bound-to:${i.bound}`, enforcer: 'avarice' });
  }
  return ok(i.bound ?? i.flag ?? i.envDefault ?? DEFAULT_PROFILE);
}
```

### Pattern 3: Redact at each persistence boundary, line by line

**What:** One `Redactor` (patterns from `secret-patterns.ts` plus literals seeded by `credential.resolve`) applied to each string leaf before `boundedEventJson`, to each transcript line before the 20 MiB cap, and by an artifact-store decorator for text kinds.
**When to use:** `appendEventRow`, `claude-host.ts` transcript step, `LocalArtifactStore` decoration, any log write.
**Example:**
```typescript
// Source: src/adapters/sqlite/events.ts (read this session): the row hash covers data_json, so redact BEFORE hashing.
const dataJson = boundedEventJson(redactLeaves(ev.data, redactor)); // redact string leaves, then bound and canonicalize
const rowHash = sha256Hex([prevHash, ts, ev.type, ev.runId ?? '', dataJson].join('\n'));
```

### Pattern 4: Adapter-internal transport reliability keeps the domain unchanged (AC-7)

**What:** The fake-remote adapters own submit/query/retry. `CommandSpec.invocationId` is the idempotency key: a dropped response is answered by a query-by-ID, a duplicated response is discarded by ID. `ArtifactStore.put` is idempotent by digest, so a dropped response is retried inside the adapter with bounded attempts. The sync `ArtifactStore` port gets latency from `Atomics.wait` (already used in `src/hook/pre-tool-use.ts` and `test/helpers/test-cli.ts`).
**When to use:** `test/helpers/fake-remote-*.ts` and the contract suite.

### Pattern 5: Fail composition softly for diagnostics

**What:** `doctor` builds its own dependency set (read-only, no migration, no GSD requirement, tolerates a bad profile root, an old or newer schema, a missing host) and reports each failure as a finding with a fix. Today `createDeps` returns `{ ok: false, code: 70 }` on any such problem (`src/cli/composition.ts:152-190`; `EXIT_INTERNAL = 70`).

### Anti-Patterns to Avoid

- **Reading the profile from the environment inside `resolveProfile` for a second profile:** `AVARICE_DATA_ROOT`/`AVARICE_WORK_ROOT`/`AVARICE_CONFIG_HOME` are single values; with several profiles they point every profile at one root and defeat AC-6. Make per-profile roots come from the profile config (read back), and honor the env override only for the selected profile.
- **Editing an applied migration:** `migrate()` refuses a checksum mismatch (`src/adapters/sqlite/migrate.ts`); add `0004`, never touch `0001` to `0003`.
- **Adding a field to a frozen `--json` shape other than at the end as an optional key:** snapshot tests in `test/unit/json-shapes.test.ts` fail (`AVARICE_SNAPSHOT_WRITE=1` regenerates deliberately).
- **Putting probes behind `src/app` imports of adapters:** the lint forbids it; use a port.
- **Letting a decision answer or a contract approval imply an action approval:** FR-13; the only writers of `approvals` are `avarice approve` and the contract source in `authorizeAction`.
- **Treating a classified shell command list as complete:** ADR-005 names `bash -c` wrappers as a known gap; the external platform stays authoritative and the docs must say so (SEC-6).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Secret detection and replacement | A second regex set | `findSecrets`, `redactSecrets`, `AVARICE_SECRET_PATTERNS` in `src/domain/secret-patterns.ts` | GSD's own pattern is reproduced verbatim so AVARICE never accepts what GSD refuses |
| Digests and canonical JSON | Ad-hoc `JSON.stringify` hashing | `digestOf`, `canonicalJson`, `sha256Hex` in `src/domain/digest.ts` | Parameter digests for approvals and `config_digest` must be stable |
| Safe git | `execFile('git')` | `runGit` (`src/adapters/git/safe-git.ts`) | Neutralizes filter drivers, refuses global options; a hostile repo ran a clean filter in Phase 1 |
| Sandboxed subprocess | `spawn` of repo or helper code | `CommandExecutor` (`SandboxedExecutor`) | `cmd:` helpers and checks must not run unsandboxed or with the whole environment |
| Canonical paths | `path.resolve` | `canonicalAbsolute`, `realpathNearest` | `/var` vs `/private/var` already cost Phase 2 a finding |
| Lease, fence, checkpoint plumbing | A new stage runner | `StageContext`/`RunStageContext` (`src/app/stages/stage.ts`, `src/app/run-stages/stage.ts`) | Kill points and fault tests hang off these |
| Insert-only tables | Application-level checks | SQLite triggers (pattern of `0002-run.ts`) | Holds for every future writer |
| Owner confirmation | A new prompt | `ask` override of `main()` and `refuseOutsideTerminal` | Shell and tests already supply it |
| Fake host for tests | A new fake | `test/helpers/fake-agent-host.ts`, `fake-run-host.ts`, `test-cli.ts` | Hook is exercised for real |
| Ledger migration with backup | Manual copy | `migrate()` (VACUUM INTO backup before the first pending migration, one transaction per migration) | Restore work in Phase 5 relies on this contract |

**Key insight:** every control in this phase already has a precedent in Phases 1 to 3 (insert-only triggers, single-transaction counters, owner-terminal commands, fail-closed launch checks). New code should look like its precedent; the cost and the risk are in wiring (composition, supervisor env, snapshots, docs), not in novel mechanisms.

## Runtime State Inventory

Phase 4 is not a rename, but D-18 migrates existing `personal-local` data and D-19 changes where other profiles' roots are discovered, so the five categories are answered explicitly.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | The owner's store `~/.local/share/avarice/personal-local/state.db` (16 runs, 1 project, 5,014 events, 235 artifacts). `meta.profile_id` is written by `migrate()` at the last pending migration (`src/adapters/sqlite/migrate.ts:119-121`) but nothing reads it. The portfolio record at `9f1cd8d` is `active`. | Migration `0004` is a data-preserving addition (indexes, optional `projects.profile_id` defaulting to `personal-local`); add a startup assertion that `meta.profile_id` equals the selected profile. Migration fault tests (`test/fault/migrations.test.ts`) must cover a store with history (backup taken, checksum recorded). |
| Live service config | None: no external service stores the profile name. | None. |
| OS-registered state | The launchd job written by `schedule` carries only `AVARICE_CONFIG_HOME`, `AVARICE_DATA_ROOT`, `AVARICE_WORK_ROOT` (`src/adapters/schedule/launchd.ts:72`, validated at `:120`). A profile flag or `AVARICE_PROFILE` would not be carried. | Extend `ENV_NAMES` (and `spawn-supervisor.ts:51-53`) with the profile name so a detached supervisor and a scheduled digest open the same profile; installed plists keep working because they name roots. |
| Secrets and env vars | `AVARICE_PROFILE` is new. No existing secret key names change. `env:` references are refused (S-49). | `doctor` must flag any profile config reference of type `env:`. |
| Build artifacts / installed packages | None: there is no build step; no egg-info or compiled output. | None. |

## Common Pitfalls

### Pitfall 1: AC-2 is already failing
**What goes wrong:** `status` with 1,000 runs is about three times over budget.
**Why it happens:** `getRunStatuses` (`src/app/run-status.ts:312-324`) calls `statusOf` per run, and each does `listRunCheckpoints`, `listEvidence`, `listGateResults`, `listDecisions`, `listWorkItems`, `listNotifications`, `getBudgets`, `getRunContract`, `getRunSteps` (plus `listRunAttempts` when interrupted). `decisions`, `gate_results` and `notifications` have no `run_id` index (the only indexes beyond primary keys are `evidence_attempt`, `events_run`, `attempts_item`, `notifications_state`), and `evidence` is read per run through a join on `attempt_id`.
**How to avoid:** batch loaders (one query per table with `WHERE run_id IN (...)`, or per project), migration `0004` indexes, and a deterministic guard test that counts statements issued by `status` and asserts the count does not grow with runs; keep the JSON shape byte-identical. Measure with `time-status`-style process timing, not in-process, because the 300 ms target includes about 129 ms of process start (measured on an empty store).
**Warning signs:** `status` wall time scaling linearly with run count; snapshot tests changing.

### Pitfall 2: The 24,000-token pack does not fit a 32 KiB prompt
**What goes wrong:** D-13 raises the pack ceiling to a size the prompt cannot carry; the prompt builder silently cuts the pack.
**Why it happens:** `PACK_BUDGET = 4000` (`src/app/run-stages/item.ts:68`) and `RUN_PROMPT_MAX_BYTES = 32 * 1024` (`src/app/run-gsd-config.ts:53`, comment: "The context pack is cut to fit; the contract text never is"). 24,000 tokens at 4 characters each is about 96 KB.
**How to avoid:** record the resolution in `docs/system/config-reference.md` and an ADR or findings line. Recommended: the profile bound `limits.contextTokens` (default 24,000) is a ceiling, the effective pack budget is `min(ceiling, floor((promptMax - contractBytes - overhead) / 4))`, and the `context:pack` step records both. If the pilot evaluation shows truncation costs task success, pass the pack in a scratch file the model reads, which adds one tool call but removes the prompt cap.
**Warning signs:** `omitted` lists that are long while `usedTokens` is far below the budget.

### Pitfall 3: Environment root overrides collapse profiles
**What goes wrong:** `AVARICE_DATA_ROOT` set for one profile makes every `--profile` open the same store.
**Why it happens:** `resolveProfile(env)` takes one profile (hard-coded) and three global overrides (`src/adapters/fs/profile-paths.ts:60-66`); the supervisor and launchd carry the same three names.
**How to avoid:** make `config.json` authoritative per profile (read it back; it is written once today and never read), apply env overrides only to the selected profile, and build `otherProfileRoots()` from `<configHome>/profiles/*/config.json` so a run's sandbox denies them (closes D-19 and `docs/system/containment.md:468`). Add this profile's own config home to the deny list.
**Warning signs:** two profiles reporting the same `dataRoot` in `doctor`; the isolation suite finding a cross-profile read.

### Pitfall 4: Redaction ordering and shape
**What goes wrong:** a secret split by the 20 MiB cap survives; a PEM body split by JSON escaping survives; the event hash chain changes; a legitimate identifier is mangled.
**Why it happens:** the transcript is redacted after capture (`src/adapters/host-claude/claude-host.ts:244`, `redactSecrets(ran.transcript)`); event strings are JSON, where a PEM block's newlines are escaped; `row_hash` covers `data_json`; the GSD pattern `sk-[A-Za-z0-9]{20,}` can match inside long alphanumeric tokens.
**How to avoid:** redact each complete NDJSON line before capping at a line boundary; redact string leaves of event data before `boundedEventJson`, so the hash covers what was stored; seed literal values with a minimum length and refuse shorter credentials rather than over-redact; test that digests, ULIDs and paths pass through unchanged. The hook entry shares `appendEventRow`, so the redactor module must stay free of CLI and app imports (lean hook, T-4 150 ms).
**Warning signs:** `findSecrets` hits in a SQLite dump after the redaction suite; changed `prev_hash` chains in fixtures.

### Pitfall 5: Approval consumption and the `idempotency_key` UNIQUE column
**What goes wrong:** a second approval for the same action and parameters after the first expired cannot be inserted.
**Why it happens:** `approvals.idempotency_key TEXT NOT NULL UNIQUE` (`migrations/0001-initial.ts:76-83`); the spec's key is the action's idempotency key for reconciliation (Phase 5 duplicate-PR rule), not an approval nonce.
**How to avoid:** derive the key from `{runId, action, paramsDigest, ordinal}` where `ordinal` counts earlier approvals for that intent, keep at-most-once initiation in the consume step (`consumed_at` set in the transaction that records the action's start) and in a run step, and record the choice in `docs/system/data-model.md`. This is an Open Question for confirmation.

### Pitfall 6: `doctor` through the normal composition path
**What goes wrong:** the command that must explain a broken environment dies with "cannot open ... exit 70".
**Why it happens:** `createDeps` (`src/cli/composition.ts:152`) returns a failure on profile, migration or store-open problems (`:154`) and probes GSD with an unsandboxed `spawnSync` of up to 5 s (`src/adapters/gsd/locate.ts:60`), and a read-only command migrates a store with pending migrations (finding `src/cli/composition.ts:145`).
**How to avoid:** a separate read-only composition for `doctor` (no migration, bounded probes, per-probe timeout, the 2 s total from `docs/operations-and-testing.md:9`). Measured offline probe costs are in the Validation Architecture section.

### Pitfall 7: `settings keys honored` cannot be proven offline (D-20)
**What goes wrong:** an unverified host patch is admitted on a probe that proves nothing about host behavior.
**Why it happens:** launch preflight checks that the generated settings file contains nine keys (`REQUIRED_KEYS`, `src/adapters/host-claude/launch-preflight.ts:59-72`, for example `[['permissions', 'defaultMode'], 'dontAsk']` and `[['sandbox', 'failIfUnavailable'], true]`), the hook script is readable and denies a Write outside the roots, and the sandbox probe applies a profile. None of these starts the host, so none shows that the host honors `dontAsk`, `failIfUnavailable` or `onFailure: block`.
**How to avoid:** the offline probe set is (a) flag presence from `claude --help` for `--setting-sources`, `--permission-prompts`, `--max-budget-usd`, `--restricted`, (b) the existing sandbox and hook self-test, (c) settings presence. Say plainly in the ADR that behavior is proven only by a live T3 run, and offer the owner a cheap one-time canary per unverified patch (the live cases cost about 0.002 USD each on haiku, 22 cases about 0.15 USD, per `test/containment/live-spend-phase3.jsonl` and LIVE-CASES). Open Question 1.

### Pitfall 8: Evaluation leakage and cost
**What goes wrong:** an index built at or after the target commit contains the answer, or 60 arm-runs cost more than the whole phase ceiling.
**Why it happens:** the pack answers from `.planning/graphs` and `.planning/intel` built at an onboarded revision; the cost evidence is 3.5286 USD for three Phase 2 units (`.planning/STATE.md`, plan 02-22 entry) against D-03's 24 USD for 60 runs.
**How to avoid:** build each arm's index at the task's base or earlier (stale indexes still answer, marked `stale`); keep held-out tests out of the agent's reach; use a lean harness on a small model with a per-run cap near 0.40 USD; run a 3-task pilot, read its cost, and only then ask the owner to approve the full spend. Record the pilot cost in the Phase 4 ledger.

### Pitfall 9: Retrieval caps need new contract keys, and the preset digest is the policy revision
**What goes wrong:** adding `retrieval` to `ROUTINE_PRESET` changes `policyRevision` (the digest of the constant).
**Why it happens:** `src/domain/run-contract.ts` `ROUTINE_PRESET` has no `retrieval` block, and `docs/contracts-and-state.md` shows `budgets.retrieval: { fullReads, fullReadBytes, searches, broadDiscovery }`. A changed constant changes the digest recorded on new contracts and may interact with amendment checks.
**How to avoid:** add the block deliberately, read how `policyRevision` is compared in `src/app/amend.ts` before editing, and keep existing contract versions readable.

### Pitfall 10: `ArtifactStore` is synchronous, the fake is not
**What goes wrong:** a fake remote that drops 5% of responses makes `checks.ts`, `activate.ts` and the host adapter fail randomly, or forces domain retries (violating AC-7).
**Why it happens:** `put`, `get`, `has` return `Result` synchronously and are called from 9 sites (`checks.ts:243,496,537`, `activate.ts:156,173`, `index-knowledge.ts:125`, `item.ts:1864`, `repair.ts:136`, `claude-host.ts:246`); the spec's port is async.
**How to avoid:** keep the port; the fake injects latency with `Atomics.wait`, and retries drops and tolerates duplicates inside the adapter (bounded attempts, `unavailable` after the bound). Use a seeded random source so a failure reproduces. State in the proof what it does not show (`docs/deployment-and-portability.md` Staging).

### Pitfall 11: `--profile` reaches code that is not `main()`
**What goes wrong:** the detached supervisor, `schedule`, and the shell open the default profile while the user selected another.
**Why it happens:** `spawn-supervisor.ts:51-53` passes only the three root variables; `schedule.ts:103` and the launchd `ENV_NAMES` do the same; the shell builds deps through `main()` overrides.
**How to avoid:** carry the profile name wherever the roots are carried and assert it in `supervise` (the store's `meta.profile_id` must equal it).

### Pitfall 12a: Two baseline tests are timing-sensitive
**What goes wrong:** a per-wave integration run reports failures that are not regressions.
**Why it happens:** `test/integration/run-status.test.ts:98` matches a time-only checkpoint stamp (`\(\d{2}:\d{2}, [^)]+\)`), which fails when a run crosses midnight and the stamp gains a date; `test/integration/run-independent-work.test.ts:298` counted 108 rows against an expected 107 under load. Both passed on an immediate re-run (40 of 40).
**How to avoid:** do not read those two as regressions on a first failure; re-run the file alone. New Phase 4 tests must not depend on the wall clock date and should use `MovableClock` (`test/helpers/decide-cli.ts`) where time matters.

### Pitfall 12: Documentation counts drift
**What goes wrong:** `coverage.md` denominators (15 commands, 24 tables, 39 event kinds, 3 migrations, 12 ports, 17 external systems, 5 admitted host versions, 35 hook rule IDs, 173 test files) go stale and the docs lint or the final reviewer fails.
**How to avoid:** the documentation plan re-runs each command in the "Denominators" table of `docs/system/coverage.md` against the final commit.

## Code Examples

### Edge relation to read rule table (FR-22), seeded by observation

Observed on the portfolio graph built by AVARICE in `~/.local/share/avarice-work/personal-local/onb_01M6J4ATTTXW68YGE2P9V2QMH5/staging/.planning/graphs/graph.json` (graphify 0.9.x, 14 relation names, counts in parentheses): `contains` (831), `calls` (203), `references` (83 INFERRED, 5 EXTRACTED), `imports` (77), `imports_from` (74), `extends` (25), `indirect_call` (25), `conceptually_related_to` (19 INFERRED, 6 AMBIGUOUS), `rationale_for` (13 INFERRED, 3 EXTRACTED), `implements` (11 INFERRED, 11 EXTRACTED), `re_exports` (10), `dynamic_import` (8), `cites` (6), `method` (1).

```typescript
// Sketch for src/domain/retrieval-rules.ts. The table is configuration; an unmapped relation is id-only (spec).
export type ReadRule = 'descendants' | 'one-hop' | 'id-only';
export const EDGE_READ_RULES: Readonly<Record<string, ReadRule>> = {
  contains: 'descendants',
  method: 'descendants',
  calls: 'one-hop', imports: 'one-hop', imports_from: 'one-hop', extends: 'one-hop',
  implements: 'one-hop', re_exports: 'one-hop', dynamic_import: 'one-hop', indirect_call: 'one-hop',
  references: 'id-only', cites: 'id-only', rationale_for: 'id-only', conceptually_related_to: 'id-only',
};
export const ruleFor = (relation: string | null): ReadRule => (relation !== null && EDGE_READ_RULES[relation]) || 'id-only';
```
The spike (Wave 0) must repeat the count on at least one Python and one Go or Rust graph before the table is frozen, and `src/adapters/context/gsd-graph.ts:119` (`readRule: 'one-hop'`) is replaced by per-edge application: GSD's reader returns nodes and edges together, so the adapter filters and shapes what comes back rather than steering the traversal.

### Privileged action gate

```typescript
// Sketch for src/app/authorize.ts. Source order: contract (with parameters), then an approval row.
export function authorizeAction(deps: AppDeps, run: RunRow, action: string, params: unknown): Result<{ source: 'contract' | 'approval'; approvalId?: string }> {
  const cls = classifyAction(action);                 // domain table; unknown action => 'privileged'
  if (cls !== 'privileged') return ok({ source: 'contract' });
  const digest = digestOf(params);
  if (contractAuthorizes(run, action, digest)) return ok({ source: 'contract' });
  // One transaction: match (run, action, digest, unexpired, unrevoked, unconsumed), set consumed_at, append the start event.
  return deps.ledger.consumeApproval({ runId: run.runId, action, paramsDigest: digest, nowMs: deps.clock.nowMs() });
}
```

### Fake-remote artifact store latency without an async port

```typescript
// Sketch for test/helpers/fake-remote-artifact-store.ts. Atomics.wait is already used for synchronous sleeps in src/hook/pre-tool-use.ts.
const sleepSync = (ms: number): void => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// put(): JSON.stringify the call (bytes as base64), sleepSync(latency), seeded drop (5%) => retry inside, seeded duplicate (2%) => second identical put (idempotent by digest).
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Admit each Claude Code patch after a live T3 run (Phases 1 to 3) | Admit a patch range inside a verified minor with a launch self-check (D-20) | This phase | One predicate replaces a list; risk moves to probe coverage |
| `--restricted` described from `--help` of 2.1.312 and 2.1.316 | Present on the installed 2.1.325: removes Bash, PowerShell, other code-running tools and WebFetch, ignores user/project/local settings, confines file tools to the working directories (`claude --help`, this session) | verified 2026-11-15 | Restricted mode can launch the same adapter with one flag |
| Whole-tree graph extraction at each refresh | Extract changed paths and merge (D-11), keeping `graphify update` unused | This phase | Needs a node-ID stability spike (Assumption A1) |
| Retained full transcripts | Redacted summary plus digest by default (D-14) | This phase | `invocation.finished` and `status` keep working from the parsed result; the transcript artifact becomes opt-in |

**Deprecated or outdated:**
- `EXISTING_MAP_OUTCOME = 'isolated-regeneration'` and `adoptionDeferred` in `src/domain/preflight.ts` (D-10).
- `GsdOnboardingAdapter.initPlanning()` returning `unsupported` "until Phase 4" and the `CAPABILITIES` entries `'map-paths': false`, `'ingest-docs': false` (`src/adapters/gsd/gsd-onboarding.ts:58,61,378`): see Open Question 7 for whether Phase 4 turns them on.

## Verified In-Repo Values

Each value below was read from its source file this session and is quoted verbatim, so a plan may reference it without re-reading. Anything not listed here and not in the Assumptions Log is a citation to a file named in the text.

| Value | Source | Verbatim |
|-------|--------|----------|
| Admitted host versions [VERIFIED: src/adapters/host-claude/launch-preflight.ts:24] | `launch-preflight.ts` | `export const ADMITTED_CLAUDE_VERSIONS: readonly string[] = ['2.1.312', '2.1.316', '2.1.317', '2.1.318', '2.1.319'];` |
| Required settings keys [VERIFIED: src/adapters/host-claude/launch-preflight.ts:59-72] | `launch-preflight.ts` | nine entries: `permissions.defaultMode` `'dontAsk'`, `permissions.disableBypassPermissionsMode` `'disable'`, `sandbox.enabled` `true`, `sandbox.failIfUnavailable` `true`, `sandbox.allowUnsandboxedCommands` `false`, `sandbox.autoAllowBashIfSandboxed` `false`, `sandbox.excludedCommands` `[]`, `sandbox.network.allowedDomains` `[]`, `sandbox.network.strictAllowlist` `true` |
| Default profile [VERIFIED: src/adapters/fs/profile-paths.ts:27] | `profile-paths.ts` | `export const DEFAULT_PROFILE = 'personal-local';` |
| Existing-map outcome [VERIFIED: src/domain/preflight.ts:48,52] | `preflight.ts` | `export const EXISTING_MAP_OUTCOME = 'isolated-regeneration';` and `export type ExistingMapClass = 'none' \| 'stamped-complete' \| 'stamped-partial' \| 'unstamped' \| 'unknown-format' \| 'user-edited';` |
| Mapping modes [VERIFIED: src/domain/mapping.ts:7,10] | `mapping.ts` | `export const MAPPING_MODES = ['skip', 'adopt', 'fast', 'full', 'paths'] as const;` and `export type Completeness = 'complete' \| 'partial' \| 'none';` |
| Context budgets [VERIFIED: src/app/context.ts:15-16, src/app/run-stages/item.ts:68, src/app/run-gsd-config.ts:53] | three files | `export const DEFAULT_CONTEXT_BUDGET = 4000;`, `export const MAX_CONTEXT_BUDGET = 100_000;`, `const PACK_BUDGET = 4000;`, `export const RUN_PROMPT_MAX_BYTES = 32 * 1024;` |
| Run blocked reasons [VERIFIED: src/domain/run-lifecycle.ts:24-32] | `run-lifecycle.ts` | `'decision', 'enforcement_failure', 'budget_exhausted', 'unauthenticated', 'ref_changed', 'ref_deleted', 'access_revoked'` |
| Onboarding blocked reasons [VERIFIED: src/domain/onboarding-lifecycle.ts:24-30] | `onboarding-lifecycle.ts` | `'enforcement_failure' \| 'budget_exhausted' \| 'existing_state_conflict' \| 'scope_unavailable' \| 'adapter_incompatible' \| 'decision'` |
| Port errors [VERIFIED: src/domain/result.ts:6-16] | `result.ts` | `{ kind: 'unsupported'; capability: string; reducedMode?: string; detail?: string }`, `{ kind: 'unauthenticated'; credentialRef: string; recovery: string }`, `{ kind: 'timeout'; afterMs: number; sideEffect: 'none' \| 'unknown' }` among ten kinds |
| Evidence kinds [VERIFIED: src/domain/evidence.ts:11] | `evidence.ts` | `export type EvidenceKind = 'check' \| 'diff' \| 'test-inventory' \| 'mutation' \| 'gsd-verdict' \| 'ci' \| 'review' \| 'manual';` |
| Approvals table [VERIFIED: src/adapters/sqlite/migrations/0001-initial.ts:76-83] | `0001-initial.ts` | `approval_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, action TEXT NOT NULL, params_digest TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, source TEXT NOT NULL, granted_by TEXT NOT NULL, granted_at TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT, revoked_at TEXT` |
| Existing indexes beyond primary keys [VERIFIED: migrations 0002 and 0003] | `0002-run.ts`, `0003-decisions.ts` | `CREATE INDEX evidence_attempt ON evidence (attempt_id);`, `CREATE INDEX events_run ON events (run_id);`, `CREATE INDEX attempts_item ON attempts (run_id, item_id);`, `CREATE INDEX notifications_state ON notifications (state);` |
| Commands [VERIFIED: src/cli/main.ts:17] | `main.ts` | `export const COMMANDS = ['init', 'repo', 'onboard', 'start', 'supervise', 'status', 'inbox', 'resume', 'context', 'install-host', 'contract', 'decide', 'digest', 'schedule', 'cancel'] as const;` |
| Graph read rule today [VERIFIED: src/adapters/context/gsd-graph.ts:119] | `gsd-graph.ts` | `readRule: 'one-hop',` for every graph handle |
| Env carried to detached jobs [VERIFIED: src/adapters/schedule/launchd.ts:72] | `launchd.ts` | `const ENV_NAMES: readonly string[] = ['AVARICE_CONFIG_HOME', 'AVARICE_DATA_ROOT', 'AVARICE_WORK_ROOT'];` |
| Credential denial list [VERIFIED: src/domain/invocation-scope.ts:388-401] | `invocation-scope.ts` | `CREDENTIAL_PATHS`: `.ssh`, `.aws`, `.config/gh`, `.gnupg`, `.netrc`, `.npmrc`, `.docker`, `.kube`, `.config/gcloud`, `Library/Keychains`, `.git-credentials`, `.pgpass` |
| Default AVARICE parents denied to a run [VERIFIED: src/domain/invocation-scope.ts:381-384] | `invocation-scope.ts` | `[join(root, '.local/share/avarice'), join(root, '.config/avarice'), join(root, '.local/share/avarice-work')]` |
| Routine preset prohibitions [VERIFIED: src/domain/run-contract.ts:109,112] | `run-contract.ts` | `prohibited: ['policy changes', 'budget changes', 'credential changes', 'merge', 'push'],` and `delivery: { endpoint: 'ready_for_review', handoff: 'local-branch', pushBranch: false, draftPr: false },` |
| `unsupported` already used for Phase 4 gaps [VERIFIED: src/adapters/gsd/gsd-onboarding.ts:58,61,378] | `gsd-onboarding.ts` | `'map-paths': false,`, `'ingest-docs': false,` and `kind: 'unsupported', capability: 'init-planning', reducedMode: 'out of scope for Phase 1; planning initialization arrives in Phase 4'` |
| GSD drift threshold default [VERIFIED: ~/.claude/gsd-core/bin/lib/drift.cjs:202-204] | GSD module | `const threshold = Number.isInteger(inp.threshold) && inp.threshold >= 1 ? inp.threshold : 3;` |
| `claude --restricted` [VERIFIED: `claude --help`, 2.1.325, run this session] | host help text | "Restricted mode: removes the built-in tools that run commands or code (Bash, PowerShell and the other code-running tools) and WebFetch unless --tools names them, and ignores user, project and local settings files (managed settings and --settings still apply ...). Also confines the file tools to the working directories" |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Running `graphify extract --code-only` on a subset of paths yields node IDs equal to the whole-tree IDs for the same files (IDs look path-derived, for example `scripts_check_contrast_usageerror`) | Common Pitfalls, Wave 0 spike | Incremental merge duplicates or orphans nodes; fall back to full extraction with diff |
| A2 | The AC-8 "tokens" metric should be the sum over distinct assistant messages of `input_tokens + cache_creation_input_tokens + cache_read_input_tokens + output_tokens` from `usage`; the parser captures none of these today (`src/adapters/host-claude/stream-json.ts` reads `total_cost_usd`, `num_turns`) | Validation Architecture | The 50% claim could flip under a different definition; record both and cost USD |
| A3 | Seeded literal redaction needs a minimum length (8 characters) below which the credential is refused | Pitfall 4 | Too low over-redacts common words; too high leaves short tokens |
| A4 | Claude Code hook input carries no token or cost fields (cited from the common-fields table; the PostToolUse section was not read) | Open Question 11 | Host limitation 3 would be answered the other way; a live capture settles it |
| A5 | `/usr/bin/security find-generic-password -s <service> -w` is the lookup for `keychain:<service>` and `delegated:gh` means "run `gh` with its own auth, AVARICE never sees the token" | Standard Stack | Wrong flags break the adapter; verify with a fixture Keychain item in the integration test |
| A6 | A lean evaluation harness on a small model can hold each arm-run near 0.40 USD | Pitfall 8 | The 24 USD allocation fails; the pilot measures it before approval |
| A7 | `batch status` queries can bring `status` with 1,000 runs under 300 ms including about 129 ms of process start | Pitfall 1 | May also need a smaller read model or lazy detail; the Wave 0 harness shows it early |
| A8 | The GSD `ingest-docs` verb needed for planning initialization exists in 1.17.0 | Open Question 7 | Adapter capability stays false |
| A9 | `AVARICE_PROFILE` and a config-home binding file are acceptable homes for selection state (D-16 names the behavior, not the storage) | Pattern 2 | Another storage location changes the S-9 test only |
| A10 | The full-remap drift threshold should follow GSD's default of 3 drift elements (`workflow.drift_threshold`), counted as new top-level directories or any manifest or workspace-structure change | Wave D | The docs give no value (`docs/repository-onboarding.md:177`); owner may prefer another |

## Open Questions

1. **D-20 "settings keys honored" at launch**
   - What we know: launch preflight proves the settings file holds nine keys, the hook denies one write, and the sandbox applies a profile; none starts the host.
   - What's unclear: whether the owner accepts flag-presence (`claude --help`) plus the existing probes as the offline set, or wants a one-time live canary per unverified patch (about 0.002 USD per case).
   - Recommendation: flag-presence plus existing probes offline; add a canary that runs once per version and is cached in the ledger; label the result `admitted (unverified patch)` either way.

2. **AC-8 arm definitions and token metric**
   - What we know: D-06 and D-07 define a baseline arm (map plus agent-found files) and an index-adapter arm; the spec's three arms are section reads, code-only graph and graph with document nodes (`docs/operations-and-testing.md:151`).
   - What's unclear: whether the three arms are baseline, code-only pack and with-knowledge pack (what D-08 reads like), and how tokens are counted.
   - Recommendation: arms = A baseline, B pack with code-only graph, C pack with knowledge graph; metric per A2; record the arm mapping against the spec in `findings.md`.

3. **Which repositories can host the evaluation and AC-14**
   - What we know: `~/aa-phan-portfolio-v2` (pin `9f1cd8d`), three owner repos with `.planning/codebase` maps and no stamp header in the one file read (`rekordbox-mcp`, `auto_search_workflow`, `Senior_Design`, all Python; whether those maps are committed was not checked), two `package.json` repos (`autobroll`, `GroceriesGPT`). Go and Cargo are not installed here.
   - What's unclear: which public Go and Rust repositories, and whether their checks run under the sandbox offline. A stamped-complete map exists in none that I read, so adoption needs a generated fixture for S-28 and the live set covers the unstamped case.
   - Recommendation: Wave 0 plan drafts the five and the twenty for owner approval; AC-14 needs mapping only (graph extraction is tree-sitter based and needs no toolchain), the evaluation needs runnable checks and so favors the owner's JS and Python repositories.

4. **Per-profile roots when env overrides are set** (Pitfall 3): confirm that env overrides apply only to the selected profile and that `config.json` becomes authoritative.

5. **Approval `idempotency_key` semantics** (Pitfall 5): confirm the ordinal approach.

6. **Where the repository binding lives:** recommended `<configHome>/bindings.json` (outside every store, `O_NOFOLLOW`, mode 0600, keyed by git root and root commit). `repo add` writes it; nothing writes to the user's repository.

7. **Slice 3 deliverables with no requirement ID:** planning initialization through `ingest-docs` and enterprise onboarding modes (`docs/implementation-plan.md:63`). CONTEXT lists neither as a decision. Recommendation: keep `initPlanning` unsupported (reduced mode named) unless the owner wants it; record the decision in `findings.md`.

8. **Refresh trigger surface:** no `refresh` command exists in the docs (`docs/extensions.md:144` says "refresh on drift"). Recommendation: `avarice onboard <repo>` on a project with an active record plans a refresh (replacing the preflight refusal), with `--mode` still honored.

9. **FR-19 before Phase 5 adapters:** `pr record <url>` and `comment --print` have no integration to substitute for yet. Recommendation: build them as ledger-only commands (record a URL as an `ExternalRef` on a run; print a comment body) so the manual path exists before the adapter.

10. **Node version rule for `doctor`:** `engines` says `>=22.22.3`; `docs/extensions.md` says "22.22.3 or newer (or 24.15.0 or newer)". Recommendation: use `engines` semantics.

11. **Host limitation 3** (hook cost fields): resolve negative by capturing one real hook input in a live case, or record it as cited-only.

12. **Representation of `partial (restricted)`:** recommend keeping `completeness: 'partial'` (the `Completeness` type is `'complete' | 'partial' | 'none'`) and appending an optional `restricted: true` key, rendered as `partial (restricted)`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | everything | yes | v26.9.0 (dev); minimum 22.22.3 | `scripts/test-matrix.sh` needs `AVARICE_NODE22` for the minimum leg (not set here) |
| `claude` | live cases, D-20, restricted mode | yes | 2.1.325 | Offline suites use fakes |
| `/usr/bin/sandbox-exec` | executor, launch probe, offline test wrapper | yes | system | none; no sandbox means no run |
| graphify | graph steps, edge spike | yes | 0.9.53 | `absent` index recorded |
| GSD gsd-core | onboarding, drift, readers | yes | 1.17.0 at `~/.claude/gsd-core` (`~/.claude-edu/gsd-core` has no `bin`) | `incompatible` state |
| git | everywhere | yes | 2.39.5 | none |
| `/usr/bin/security` | `keychain:` adapter | yes | system | fixture provider in tests |
| `gh` | `delegated:gh` (Phase 5 uses it) | yes | installed, not used in code | not needed in Phase 4 |
| python3 | pty driver for shell tests | yes | /usr/bin/python3 | none |
| Go, Cargo | building non-JS benchmark repos | no | none | AC-14 needs mapping only; the evaluation avoids them |
| `AVARICE_NODE22` | two-Node test matrix | no (unset) | none | run the dev-Node leg only; set before the phase gate |
| `node_modules` in this worktree | `npm run typecheck` | no (not installed; `@types/node` and `typescript` resolve from the ancestor `/Users/aphan/avarice/node_modules`) | typescript 7.0.2 | run `node /Users/aphan/avarice/node_modules/typescript/bin/tsc -p .` (exit clean, no output, measured this session) or `npm ci` |

**Missing dependencies with no fallback:** none for planning.
**Missing dependencies with fallback:** Go and Cargo (use mapping-only repos for Go and Rust stacks), `AVARICE_NODE22` (set before the final matrix run).

Measured costs for the `doctor` budget (2 s total, `docs/operations-and-testing.md:9`) are in the Validation Architecture section.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` built into Node (dev v26.9.0, minimum 22.22.3), TypeScript run directly by type stripping; no test dependency |
| Config file | none; tiers are directories: `test/unit`, `test/integration`, `test/fault`, `test/mutation`, `test/containment` (live only with `AVARICE_LIVE=1`), `test/benchmark` |
| Quick run command | `node --test test/unit/<file>.test.ts` (one file); gates per task: `npm run check:boundaries` and `npm run typecheck` |
| Full suite command | `npm test` (`node --test`); two-Node matrix `AVARICE_NODE22=/path/to/node-v22.22.3/bin/node bash scripts/test-matrix.sh` |
| Baseline measured | unit tier `node --test "test/unit/**/*.test.ts"`: 2,295 tests, 0 fail, 68 s on this machine (measured 2026-11-15) |
| Integration baseline | `node --test "test/integration/**/*.test.ts" "test/fault/**/*.test.ts" "test/mutation/**/*.test.ts"`: 1,565 tests, 1,563 pass, 2 fail in 852 s (14 min) on this machine (measured 2026-11-15 to 16); both failures passed on an immediate re-run of their two files (40 of 40) and are timing-sensitive: `run-status.test.ts:98` expects a time-only checkpoint stamp and the run crossed midnight (the status line printed `2026-11-15 23:59, 1 min ago`), and `run-independent-work.test.ts:298` counted 108 rows where it expected 107 while the machine was loaded. Treat both as flakes, not regressions, and keep the integration tier out of per-task gates |
| Live tier | `AVARICE_LIVE=1 node --test test/containment/<suite>.test.ts`; spend recorded in a new `test/containment/live-spend-phase4.jsonl`, ceiling 40 USD, lower-only `AVARICE_PHASE4_CEILING_USD`, mirroring `live-spend-ceiling.test.ts` (Phase 3: `AVARICE_PHASE3_CEILING_USD`, `PHASE3_CEILING_USD`, `CURRENT_SPEND_PHASE`) |
| Offline wrapper | `test/helpers/offline.ts` runs any command under `sandbox-exec` with the network denied (proves NFR-2, and is the base for the `doctor` offline test) |

### Phase Requirements to Test Map

New test file names follow the existing kebab-case layout. "Exists" marks a file to extend; everything else is Wave 0 or the owning wave.

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ONB-6 | Stamped-complete map with a passing drift check is adopted; `unknown-format` and `user-edited` regenerate in isolation; user edits never overwritten; uncommitted source changes noted; S-28, S-29 | unit + integration | `node --test test/unit/preflight.test.ts test/integration/onboard-adopt.test.ts` | extend preflight.test.ts; onboard-adopt.test.ts Wave 0 gap |
| ONB-6 | Promotion `copy` writes only absent or byte-identical targets, `commit` makes one branch; both need the action gate | integration | `node --test test/integration/promotion.test.ts` | Wave 0 gap |
| ONB-11 | Drift and changed paths choose incremental, path-scoped or full; threshold and manifest rule; S-34 reads only inside scope | unit + integration | `node --test test/unit/refresh-plan.test.ts test/integration/refresh-scoped.test.ts` | Wave 0 gap |
| ONB-11 | Changed-path graph merge equals a full rebuild for those paths (spike A1) | integration | `node --test test/integration/graph-incremental.test.ts` | Wave 0 gap |
| ONB-15 | Only changed documents re-extracted; `.planning/phases/**` and `STATE.md` become document nodes; S-47 | integration | `node --test test/integration/knowledge-refresh.test.ts` | Wave 0 gap (extend knowledge-pass.test.ts fixtures) |
| FR-3 | Pack items carry source identity, revision, retrieval time, scope; bounded by profile budget | integration | `node --test test/integration/context.test.ts` | exists; extend |
| FR-8 | On resume each pack ref is refreshed or marked stale; a changed brief gives `ref_changed`; S-5 | integration | `node --test test/integration/run-resume-refs.test.ts` | Wave 0 gap |
| FR-12 | Classification table total; privileged needs a bound approval or a contract that authorizes it with parameters | unit | `node --test test/unit/action-class.test.ts test/unit/approval.test.ts` | Wave 0 gap |
| FR-12, FR-13 | Approval single use, run/action/digest bound, 30 min expiry, revoked, consumed in the starting transaction; a decision answer or plan approval writes no `approvals` row | integration + fault | `node --test test/integration/approvals.test.ts test/fault/approval-consume.test.ts` | Wave 0 gap |
| FR-12 | Hook denies privileged shell forms (attended and run) with the rule ID and `avarice approve <id>`; S-4, S-7 | integration | `node --test test/integration/hook-privileged.test.ts` | Wave 0 gap (extends hook.test.ts patterns) |
| FR-14 | Injection text in the brief, index excerpts or tool output changes no policy, grants no approval | unit + integration | `node --test test/unit/policy-sources.test.ts test/integration/untrusted-authority.test.ts` | Wave 0 gap |
| FR-15 | A privileged step interrupted by a kill is never replayed by `resume`; a decision is opened | fault | `node --test test/fault/privileged-no-replay.test.ts` | Wave 0 gap (synthetic action) |
| FR-16 | A step requiring a missing capability returns `unsupported` naming the capability and `reducedMode`; no simulated success | unit | `node --test test/unit/capability-requirements.test.ts` | Wave 0 gap |
| FR-17, FR-18 | Extension names are namespaced and absent from core capability lists; provider IDs pass through verbatim | unit | `node --test test/unit/extensions-namespace.test.ts test/unit/external-ref-identity.test.ts` | Wave 0 gap |
| FR-19 | `context add`, `evidence add`, `pr record`, `comment --print`, `approve` work offline and record provenance | integration | `node --test test/integration/manual-equivalents.test.ts` | Wave 0 gap |
| FR-22 | Per-edge rule table; unmapped relation is `id-only`; S-54 handles 3,000/2,500/800 under a 4,000 budget read 3,000 and 800 and list the omitted 2,500 | unit + integration | `node --test test/unit/edge-rules.test.ts test/integration/context-handle-first.test.ts` | Wave 0 gap |
| SEC-1 | Isolation suite: 0 cross-profile reads (AC-6); S-9 mismatch reads neither store; S-37; moved roots denied to other profiles' runs | integration | `node --test test/integration/profile-isolation.test.ts test/integration/run-sandbox-other-profiles.test.ts` | second exists; extend; first is a gap |
| SEC-2 | Reference grammar; `env:` refused in every profile and fails `doctor`; every lookup writes a value-free `credential.resolve`; resolved value seeds the redactor; S-48, S-49 | unit + integration | `node --test test/unit/credential-ref.test.ts test/integration/credential-broker.test.ts` | Wave 0 gap |
| SEC-3 | Redaction suite: 0 secret patterns in events, evidence, artifacts, logs and a SQLite dump (AC-5); a secret spanning the 20 MiB cap is redacted; default retention is summary plus digest | unit + integration | `node --test test/unit/redactor.test.ts test/integration/redaction-suite.test.ts` | Wave 0 gap |
| SEC-4 | Precedence organization > defaults > user > repository; lower ranks only restrict; invalid rank-1 denies every privileged action; remote-pattern refusal | unit | `node --test test/unit/policy-precedence.test.ts` | Wave 0 gap (fixture `test/fixtures/org-acme/`) |
| SEC-6 | Every control row names enforcer and bypass limit; a control without both fails | unit | `node --test test/unit/enforcement-map.test.ts` | Wave 0 gap (pattern: `containment-matrix.test.ts`) |
| SEC-7 | No employer-specific string or file outside `test/fixtures`; fixture org uses a reserved name | unit | `node --test test/unit/footprint.test.ts` | exists; extend |
| CON-4 | Unenforceable host refuses naming `--restricted`; `--restricted` runs on a disposable copy, no Bash, no write outside it, status shows `restricted`, onboarding yields `partial (restricted)`; S-22 | integration | `node --test test/integration/restricted-mode.test.ts` | Wave 0 gap |
| CON-10, CON-11 | Whole-repository search refused without `broadDiscovery`, allowed once; result, byte, page, timeout, cancel, cumulative caps; counters exact under parallel calls; S-16, CS-16 | unit + integration + fault | `node --test test/unit/retrieval-rules.test.ts test/integration/retrieval-caps.test.ts test/fault/retrieval-race.test.ts` | Wave 0 gap |
| CON-12 | A cached item is not reused after `denied` or `unauthenticated`, after scope change or in another profile | integration | `node --test test/integration/cache-scope.test.ts` | Wave 0 gap |
| OPS-1 | `doctor` offline (under `offline.ts`), under 2 s, `--json`, no secrets, enforcement level; S-1 | integration | `node --test test/integration/doctor.test.ts` | Wave 0 gap |
| OPS-5 | Each bound configurable; each degrades as defined (drop lowest-ranked, queue, refuse with message) | unit + integration | `node --test test/unit/resource-bounds.test.ts test/integration/resource-degradation.test.ts` | Wave 0 gap |
| OPS-6 | A GSD, host or schema version outside range is reported with an actionable message; records marked `incompatible`; S-38; patch admission rule; unverified patch with a failing probe refuses | unit + integration | `node --test test/unit/host-admission.test.ts test/integration/doctor-versions.test.ts` | Wave 0 gap (extend live-admission-override.test.ts) |
| NFR-4 | The shared contract suite and the workflow suites pass against local and fake-remote adapters; domain and app untouched (AC-7) | contract + integration | `node --test test/contract/*.test.ts test/integration/portability-proof.test.ts` | Wave 0 gap |
| AC-2 | `status` p95 under 300 ms with 1,000 runs; a deterministic guard counts statements and asserts no growth with run count | benchmark + integration | `node scripts/status-bench.ts` (seeds 1,000 runs, 100 timed runs, p50 and p95) and `node --test test/integration/status-queries.test.ts` | Wave 0 gap |
| AC-8 | Index-adapter arm matches the baseline's task success at no more than 50% of its tokens; knowledge-pass default rule | live benchmark | `AVARICE_LIVE=1 node scripts/eval-retrieval.ts` (owner-gated, spend ledger) | Wave 0 gap |
| AC-14 | 5 of 5 repositories reach an active profile with no source change and 0 containment failures | live benchmark | `bash scripts/exit-run-phase4.sh` (modeled on `exit-run-phase3.sh`) | Wave 0 gap |

### Sampling Rate

- **Per task commit:** the touched test files plus `npm run check:boundaries` (passes: 99 files, measured) and the typecheck (`npm run typecheck`, or the `tsc` invocation in Environment Availability inside this worktree).
- **Per wave merge:** `node --test "test/unit/**/*.test.ts"` (about 68 s) and the integration, fault and mutation tiers; snapshots unchanged (`AVARICE_SNAPSHOT_WRITE` unset).
- **Phase gate:** `npm test` on the development Node and on Node 22.22.3 through `scripts/test-matrix.sh`, then offline exit suites (isolation, redaction, AC-2, portability) green before any live case (D-04), then T3 live cases, then the AC-14 and AC-8 runs, then the documentation plan and fresh reviews.

### Wave 0 Gaps

- [ ] `scripts/status-bench.ts` and `test/integration/status-queries.test.ts`: seed 1,000 runs from template rows (the approach used for the measurement below), report p50 and p95, assert constant statement count.
- [ ] `test/containment/live-spend-phase4.jsonl` guard in `test/helpers/live-harness.ts` (`CURRENT_SPEND_PHASE` becomes 4) with a unit test beside `live-spend-ceiling.test.ts`.
- [ ] `test/fixtures/org-acme/` fixture organization package (policy rank 1, remote patterns, a deliberately invalid policy file) and a generated stamped-complete GSD map fixture for S-28.
- [ ] `test/helpers/fake-remote-executor.ts`, `fake-remote-artifact-store.ts`, a seeded fault source, and `test/contract/` (the shared suite).
- [ ] `scripts/eval-retrieval.ts`, `scripts/exit-run-phase4.sh`, `test/benchmark/phase4/` with the owner-approved task and repository lists.
- [ ] Spike records under `spikes/phase-4-wave-0/` (edge relations, node-ID stability, host probes), following `spikes/phase-3-wave-0/`.
- [ ] Framework install: none.

### Measured baselines (this machine, 2026-11-15, Node v26.9.0)

| Measurement | Result | Method |
|-------------|--------|--------|
| `status --json`, empty store | p50 129 ms (125 to 132 ms over 10 runs on a quiet machine; 134 ms in the first, noisier run) | spawn of `node bin/avarice.ts status --json`, temp profile |
| `status --json`, 1,016 runs | p50 924 ms (916 to 1,173 ms over 10 runs, quiet machine; 914 ms in the first run), 791,043 bytes of output; text form p50 921 ms | same, store built by cloning the 15 non-onboarding runs of the owner's store (runs, contracts, budgets, work items, attempts, checkpoints, steps, evidence, gates, decisions, notifications) with new IDs |
| `status --json`, same 1,016-run store plus `CREATE INDEX` on `decisions(run_id)`, `gate_results(run_id)`, `notifications(run_id)`, `attempts(run_id)`, `runs(project_id)` (no code change; `attempts` was already covered by its `UNIQUE (run_id, ordinal)`) | p50 360 ms (355 to 391 ms over 10 runs), quiet machine | same harness; the clean rerun on the unindexed store gave p50 924 ms and the empty store p50 129 ms |
| Probe costs for `doctor` | `claude --version` 11 to 39 ms, `gsd-tools.cjs runtime-identity --raw` 72 to 76 ms, `graphify --version` 31 to 58 ms, sandbox probe 6 to 7 ms: about 150 ms in total, so the 2 s budget (`docs/operations-and-testing.md:9`) is safe when every probe has its own short timeout (the 5 s `runtime-identity` timeout and the 10 s host probe timeout in current code are the risk, not the typical cost) | `spawnSync` timing script, 3 runs each, quiet machine |

## Security Domain

`security_enforcement` is absent from config, so it is treated as enabled. The product is a local CLI, so the ASVS chapters map to its own surfaces.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (credential references only) | Broker over `delegated:`, `keychain:`, `cmd:`; `env:` refused; no stored secret (ADR-009) |
| V3 Session Management | no | No sessions; approvals are single-use records |
| V4 Access Control | yes | Classification table, policy precedence, parameter-bound single-use approvals, profile isolation, owner-terminal identity for `approve` |
| V5 Input Validation | yes | Hand parsers returning `Result` (profile name, credential reference, `--paths`, `cmd:` helper, policy files, binding file); `O_NOFOLLOW`, size caps, `0600` modes |
| V6 Cryptography | yes (digests only) | `sha256` through `src/domain/digest.ts`; never a digest, length or hash of a secret value in an event |
| V7 Error Handling and Logging | yes | Redactor at event, log, transcript and artifact boundaries; hash-chained events (tamper-evident against casual edits only) |
| V8 Data Protection | yes | Per-profile roots (0700), store 0600, redacted summary plus digest by default, caches scoped by profile and access |
| V12 Files and Resources | yes | Disposable copy for restricted mode, symlink refusal, canonical paths, create-only writes to the user's repository |
| V14 Configuration | yes | Profile config read with caps and `O_NOFOLLOW`; contract may only narrow; repository file cannot loosen organization rules |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection in a ticket, document or tool output asks for a push or a policy change (FR-14) | Elevation | Policy sources whitelist (defaults, profile, organization file, repository `.avarice/policy.json`); retrieved text is fenced data (S-46); approvals only from `avarice approve` or a contract |
| Cross-profile read through a moved root or an env override (SEC-1, D-19) | Information disclosure | Per-profile `config.json` authoritative; run sandbox denies every other known profile's roots and this profile's config home; store `meta.profile_id` checked at open |
| Profile confusion by `--profile` path tricks or a planted binding file | Tampering | Strict profile-name grammar (`personal-local`, `personal-extended`, `enterprise-<org>` with a fixed character class), binding file opened without following symlinks, owner and mode checked |
| Credential value in an event, artifact, log or process list | Information disclosure | Value-free `credential.resolve`; seeded redactor; `cmd:` helper run by argv through the sandboxed executor with a scrubbed environment; `security -w` output captured, never logged |
| Approval replay, reuse across parameters, or consumption race | Elevation | Single-use `consumed_at` set in the starting transaction; match on run, action and parameter digest; expiry 30 minutes; revoke; fault test for the race |
| Rank-1 policy file missing or corrupt | Tampering | Invalid or unreadable rank-1 file denies every privileged action; lower ranks only add restrictions |
| Obfuscated shell (`bash -c`, aliases, scripts) hides a push | Elevation | Documented bypass limit (ADR-005, SEC-6); the sandbox and the external platform are authoritative; run purposes already deny `git`, `gh`, `curl` prefixes |
| Restricted mode escape (code tools re-enabled, writes outside the copy) | Elevation | Launch with `--restricted` and the generated settings, disposable copy, `doctor` and `status` label; no fallback to unrestricted (CON-4) |
| Unverified host patch changes containment semantics (D-20) | Elevation | Flag-presence, sandbox and hook probes at launch, new minor refuses, `admitted (unverified patch)` label, live T3 evidence recorded |
| Cache poisoning across profiles or after revocation (CON-12) | Tampering | Cache keys include profile, version and scope; `denied` and `unauthenticated` purge or bypass |
| Spend runaway in live evaluation | Denial of service | Phase 4 ledger with a lower-only ceiling, per-run caps, owner stop before exceeding |

## Recommended Plan and Wave Structure

D-01 locks one phase and one PR with five workstreams, so the recommendation is about plan granularity and ordering, not a split. Phase 3 had 73 plans and Phase 2 had 35; a phase of this width fits about 36 plans if each is one mechanism with its own tests. Plans marked **L** spend live money and wait for an owner checkpoint (D-04, D-05, D-07). The final plan is the `docs/system/` pass (CLAUDE.md, SC6).

| Wave | Plans | Workstream | Requirements and acceptance |
|------|-------|------------|-----------------------------|
| 0 (parallel, no dependency) | 01 edge-relation spike (repeat on Python plus Go or Rust graphs, freeze the table); 02 incremental-graph node-ID spike (A1); 03 AC-2 harness and constant-query test (shows the failing baseline); 04 Phase 4 spend ledger and ceiling guard; 05 exit-input drafts: AC-14 list of 5 with pins and the 20 evaluation tasks, with owner checkpoints; 06 host probes: `claude --help` flag set on the installed version, offline `--restricted` launch args, one hook-input capture for limitation 3 | E, C, A | FR-22, ONB-11, AC-2, D-03, D-05, D-07, CON-4 |
| 1 (A and B) | 07 profile model, selection, binding, config parser, `--profile` threading through `main()`, supervisor and launchd env; 08 migration `0004` (AC-2 indexes, approvals index, `projects.profile_id`), `meta.profile_id` assertion, profile registry for moved roots, run sandbox denies; 09 `Redactor` plus event, transcript (line-wise before the cap), artifact and log boundaries plus D-14 retention; 10 `CredentialProvider` port and three adapters, `env:` refusal, `credential.resolve`, redactor seeding; 11 isolation suite and redaction suite (AC-6, AC-5); 12 capability requirements, `Unsupported` path, adapter registry and descriptor recording for every adapter, extension namespacing; 13 `ContextSource.refresh`, `git-files` and `gsd-planning` adapters, `task_refs` writer, FR-8 resume refresh | A, B | SEC-1, SEC-2, SEC-3, FR-16, FR-17, FR-18, FR-8, FR-3, AC-5, AC-6 |
| 2 (C) | 14 action classification and policy model with the fixture org package; 15 approvals ledger methods, `authorizeAction`, `avarice approve`, FR-15 no-replay; 16 hook privileged-action classification (run and attended) and `install-host` hook; 17 restricted mode (host, disposable copy, status label, restricted onboarding); 18 `doctor` (offline, `--json`, `--online`, `--repair`, `--extensions`, env: finding); 19 host admission rule, ADR, GSD upgrade incompatibility marking; 20 manual equivalents; 21 SEC-6 enforcement map table and test; 22 status read model batching (AC-2) | C, E | FR-12, FR-13, FR-14, FR-15, FR-19, SEC-4, SEC-6, SEC-7, CON-4, OPS-1, OPS-6, AC-2 |
| 3 (D) | 23 classification outcomes, stamped-map adoption, `files.delete`, mapping modes `adopt` and `paths`; 24 refresh planner (drift threshold, `onboard` on an active record, lifecycle `stale` edges); 25 promotion `copy` and `commit` through the action gate | D | ONB-6, ONB-11 |
| 4 (E) | 26 per-edge read rules, assembler, progressive steps, caps guard, contract `retrieval` keys, broad discovery; 27 OPS-5 bounds, 24,000-token default and prompt-cap resolution, cache scoping; 28 incremental graph and knowledge refresh; 29 token capture in the stream parser and the lean evaluation harness with the 3-task cost pilot | E | FR-22, CON-10, CON-11, CON-12, OPS-5, ONB-11, ONB-15, FR-3, AC-8 groundwork |
| 5 | 30 fake-remote executor and artifact store, contract suite, portability proof; 31 assemble the offline exit suites and run them green | B | NFR-4, AC-7 |
| 6 (live, **L**) | 32 T3 live containment cases (host admission under D-20, restricted mode, approvals; about 8 USD); 33 AC-14 five onboardings with the knowledge pass (about 8 USD); 34 AC-8 three-arm evaluation (about 24 USD, only after plan 29's pilot is read and the task list approved); 35 knowledge-pass ADR from the result | all | AC-14, AC-8, D-08, D-20 |
| 7 | 36 documentation pass | all | SC6 |

**Ordering rules that matter:**
- Plans 07 and 08 gate everything that reads profile config or the schema; plan 12 gates 30 (the fake remote needs the adapter registry).
- Plan 22 (status batching) depends only on 08 and can move to Wave 1 if the AC-2 baseline is worrying.
- Plan 29's pilot, not the 24 USD figure, decides whether plan 34 runs as designed (Pitfall 8).
- Owner checkpoints are blocking before plans 32, 33 and 34; the owner also rules on each unexpected live stop (D-04).

**Where a cut could fall if scope must shrink (still one PR):** D-01 forbids decimal sub-phases, but the two plans with the most cost and least code, 34 and 33, can be sequenced last and verified separately; everything offline stays green first.

## Sources

### Primary (HIGH confidence)

- Repository files read this session: `src/adapters/fs/profile-paths.ts`, `src/adapters/fs/profile-config.ts`, `src/ports/capability.ts`, `src/ports/context-source.ts`, `src/ports/command-executor.ts`, `src/ports/artifact-store.ts`, `src/ports/gsd-onboarding.ts`, `src/ports/agent-host.ts`, `src/domain/result.ts`, `src/domain/preflight.ts`, `src/domain/mapping.ts`, `src/domain/onboarding-lifecycle.ts`, `src/domain/secret-patterns.ts`, `src/domain/run-contract.ts`, `src/domain/run-lifecycle.ts`, `src/domain/invocation-scope.ts`, `src/domain/root-rules.ts`, `src/adapters/sqlite/events.ts`, `src/adapters/sqlite/migrate.ts`, migrations `0001` to `0003`, `src/cli/composition.ts`, `src/cli/main.ts`, `src/cli/identity.ts`, `src/cli/commands/{repo,init,context,install-host}.ts`, `src/app/context.ts`, `src/app/deps.ts`, `src/app/status.ts`, `src/app/run-status.ts`, `src/app/run-context.ts`, `src/app/stages/{register,workspace,map}.ts`, `src/adapters/context/{gsd-graph,freshness}.ts`, `src/adapters/host-claude/{launch-preflight,claude-host}.ts`, `src/adapters/host/unavailable-host.ts`, `src/adapters/gsd/{locate,gsd-onboarding}.ts`, `src/adapters/graph/graphify.ts`, `src/ports/graph-tool.ts`, `test/helpers/{test-cli,offline}.ts`, `test/unit/footprint.test.ts`, `scripts/check-boundaries.ts`, `docs/system/{README,coverage,findings,containment}.md`, `test/containment/LIVE-CASES.md`.
- Specifications read: `docs/requirements.md` (AC table), `docs/implementation-plan.md` (slice 3), `docs/operations-and-testing.md` (doctor, bounds, targets, S-scenarios, evaluation, portability proof), `docs/contracts-and-state.md` (ports, approvals, freshness, configuration), `docs/containment.md` (restricted mode, retrieval caps, host limitations), `docs/enterprise-adaptation.md`, `docs/repository-onboarding.md`, `docs/extensions.md`, `docs/deployment-and-portability.md`, `docs/decisions/ADR-005`, `ADR-009`.
- Commands run: `claude --help` and `claude --version` (2.1.325), `graphify --version` (0.9.53), `gsd-tools.cjs runtime-identity --raw`, `node --test "test/unit/**/*.test.ts"`, a status timing harness under `/tmp/p4-probe/`.
- GSD 1.17.0 drift module `~/.claude/gsd-core/bin/lib/drift.cjs` (threshold default 3 at lines 202 to 204).

### Secondary (MEDIUM confidence)

- Claude Code hooks documentation `https://code.claude.com/docs/en/hooks` (common input fields; PostToolUse section not read).

### Tertiary (LOW confidence)

- None relied on. Items resting only on training knowledge are in the Assumptions Log.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, nothing new is installed and every tool version was read.
- Architecture: HIGH for seams and constraints (source read), MEDIUM for module naming (planner may rename).
- Pitfalls: HIGH for 1, 2, 3, 4, 6, 7, 10 (measured or read in source); MEDIUM for 5, 8, 9.
- Benchmark design and cost: MEDIUM, resting on Phase 2 and Phase 3 spend records and unproven harness cost (A6).

**Research date:** 2026-11-15
**Valid until:** 2026-12-15 (the host and graphify versions move weekly; recheck `claude --version` and `claude --help` before plan 06 and plan 32)

