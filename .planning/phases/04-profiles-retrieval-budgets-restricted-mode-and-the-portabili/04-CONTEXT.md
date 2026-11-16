# Phase 4: Profiles, retrieval budgets, restricted mode and the portability proof - Context

**Gathered:** 2026-11-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Slice 3 of `docs/implementation-plan.md` (deliverables at `docs/implementation-plan.md:62-66`), 28 requirements: ONB-6, ONB-11, ONB-15, FR-3, FR-8, FR-12 to FR-19, FR-22, SEC-1, SEC-2, SEC-3, SEC-4, SEC-6, SEC-7, CON-4, CON-10, CON-11, CON-12, OPS-1, OPS-5, OPS-6, NFR-4. Acceptance criteria AC-2, AC-5, AC-6, AC-7, AC-8, AC-14 and the six success criteria in `.planning/ROADMAP.md` (Phase 4).

AVARICE runs under separate profiles with no fallback. Credentials are resolved by reference, and events and logs are redacted. Retrieval is handle-first, progressive and capped, with a rule per edge type. Privileged actions need an approval bound to their parameters. A host without enforcement runs only in explicit restricted mode. `doctor` reports health offline. Existing GSD artifacts are adopted, refreshed or migrated, never silently overwritten. The workflow suite runs unchanged against local and fake-remote adapters.

Excluded: real remote adapters (Phase 7), enterprise policy delivery and sources (not planned), Stage 2 `engines.gsd` gating (Phase 6), delivery to a PR (Phase 5).

</domain>

<decisions>
## Implementation Decisions

### Phase structure, order and spend
- **D-01:** **One phase, one PR, grouped into five workstreams with waves by dependency.** Phase 4 stays one phase on this branch (memory rule: one PR per phase). Its plans fall into five workstreams: (A) profiles, credentials, redaction and isolation; (B) ports, capability requirements and the `Unsupported` path; (C) approvals and policy, restricted mode and `doctor`; (D) brownfield adoption, refresh and promotion; (E) retrieval, including the edge-mapping spike and the three-arm evaluation. The fake-remote portability proof and the documentation pass come last. The phase is not split into decimal sub-phases.
- **D-02:** **Foundations first.** Wave order: A and B first, because everything else reads profile config and capability descriptors; then C; then D; then E; then the fake-remote proof (AC-7); then documentation. The planner refines this by dependency.
- **D-03:** **The live-model spend ceiling for Phase 4 is 40 USD**, enforced mechanically as in Phase 2 D-15 and Phase 3 D-05. A separate Phase 4 ledger holds it, and an environment variable can only lower it. Execution stops and asks the owner before exceeding it. Rough allocation: three-arm eval about 24, five AC-14 onboardings with the knowledge pass about 8, live containment cases (restricted mode, approvals, host admission) about 8.
- **D-04:** **Phase 3's exit discipline carries over** (Phase 3 D-26 to D-39). Every unexpected live stop is classified, with evidence, as a product defect or a brief/harness defect. Claude proposes the classification and the owner rules on it at a checkpoint. Live work stops after 2 failures of the same exit item within an epoch. A proven, owner-confirmed product-defect fix starts a new epoch. Offline suites run before live cases, and live cases run before benchmark runs (Phase 2 D-07).

### Benchmarks and retrieval evaluation
- **D-05:** **AC-14 benchmark set: 5 brownfield repositories mixing the owner's own repositories and pinned public open-source repositories.** It includes `~/aa-phan-portfolio-v2`, up to one or two more of the owner's repositories, and public repositories at fixed commits, so the set covers varied stacks (for example Python, Go and Rust). **At least one repository must already carry GSD artifacts (`.planning/`)** so ONB-6 adoption is exercised. Claude drafts the list with stacks and commits, and the owner approves or swaps entries at a checkpoint before any live spend. Pass bar: 5 of 5 reach an active profile with no source change and 0 containment failures.
- **D-06:** **The AC-8 baseline arm is the evaluation doc's definition: the GSD codebase map plus the files the agent finds itself** (`docs/operations-and-testing.md:151`). The literal full repository is not the baseline. The conflict with the requirement's "full-repo baseline" wording (`docs/requirements.md:237`) goes to `docs/system/findings.md`.
- **D-07:** **The three-arm evaluation uses 20 replayed historical commits.** Claude mines them from the owner's repositories (the portfolio and the AC-14 set). For each task, the brief comes from the commit message, the base is the commit's parent, and success means the required checks pass and a held-out test taken from the commit passes. The owner approves the task list at a checkpoint before spend. "Reviewer judgment" becomes a sampled owner spot-check, not a gate. AC-8 passes when the index-adapter arm matches the baseline's task success at no more than 50% of its tokens.
- **D-08:** **Knowledge-pass default rule: the knowledge pass stays on unless the with-knowledge arm shows no task-success gain over code-only and also costs more tokens.** The outcome is recorded as an ADR in `docs/decisions/` either way. — **Reversibility:** reversible — a default in profile config.
- **D-09:** **Retrieval caps start from the illustrative values in `docs/containment.md:173-187`.** They become profile-configurable defaults (OPS-5) and are tuned only if the evaluation shows a cap causing task failures. The final values are recorded in `docs/system/config-reference.md`.

### Spec-versus-code conflicts (resolved)
- **D-10:** **ONB-6 adoption follows the spec.** Implement classification and the outcomes adopt, refresh, migrate, isolated regeneration and recorded decision per `docs/repository-onboarding.md:266-290`, including adoption of a stamped map whose drift check passes. Unblock the `adopt` and `paths` mapping modes (`docs/repository-onboarding.md:167-181`) and populate `files.delete` per the Refresh rule. Isolated regeneration remains the outcome for `unknown-format` and `user-edited` maps, and user edits are never overwritten. This replaces the blanket `EXISTING_MAP_OUTCOME = 'isolated-regeneration'` and the "until Phase 4" refusals in `src/domain/preflight.ts`. Close findings `docs/system/findings.md:45-47`.
- **D-11:** **ONB-11 incremental graph refresh keeps AVARICE's own extract-and-merge pipeline, extracting only the changed paths.** It does not use `graphify update .`. This keeps the slice 0 spike's choice and the built code. The deviation from `docs/repository-onboarding.md:313` is recorded in `findings.md`. ONB-15 knowledge refresh re-extracts only changed documents and adds `.planning/phases/**` and `STATE.md` (S-47).
- **D-12:** **An unenforceable or unadmitted host still refuses by default, with a message naming `--restricted`.** Restricted mode runs only on that explicit opt-in. It works on a disposable copy with no network and no writes outside it, its output is a plan, a patch and a decision list, and `status` labels the run `restricted` (`docs/containment.md:153-161`, S-22). Restricted onboarding produces a fast map labeled `partial (restricted)`. It never falls back to instructions or unrestricted execution (CON-4). Close finding `docs/system/findings.md:90`.
- **D-13:** **The default context pack budget rises to 24,000 tokens** (`docs/operations-and-testing.md:69`, `docs/contracts-and-state.md:887`) and is profile-configurable. The planner checks how this interacts with the run prompt-size limit (32 KiB, `docs/system/config-reference.md`) and records the resolution. `avarice context` keeps its `--budget` override.
- **D-14:** **SEC-3: full tool payloads are not retained by default.** By default a run keeps a redacted summary and a digest of each transcript. Whole redacted transcripts are kept only on an explicit profile or debug opt-in. Events and logs pass through the redactor before persistence, which means applying `src/domain/secret-patterns.ts` in `appendEventRow` and in log writes. The planner also addresses redaction running after the 20 MiB transcript cap (`docs/system/findings.md:75`).
- **D-15:** **The promotion mode defaults to `none`, with `copy` and `commit` as explicit opt-ins** (`docs/repository-onboarding.md:159-165`). This settles the open owner decision at `README.md:188`. Promotion never overwrites user edits or uncommitted source changes (ONB-6).

### Profiles in practice
- **D-16:** **Profile selection uses the repository binding plus `--profile`.** `repo add --profile <name>` binds a repository. Commands on a bound repository use its profile, and other commands take `--profile` with `personal-local` as the default. An `AVARICE_PROFILE` environment variable may set the default but never overrides a binding. A mismatch refuses and reads neither store (S-9). A repository whose remote matches an enterprise pattern but is registered in a personal profile is refused (`docs/enterprise-adaptation.md:53-63`).
- **D-17:** **`personal-extended` and `enterprise-<org>` are modeled, and tested with fixtures.** `personal-extended` is a personal profile that allows extra credential providers and integrations (for example `delegated:gh` for Phase 5 PRs). `enterprise-<org>` is built and tested against a fixture organization package under `test/fixtures`. The tests cover policy precedence (organization, then built-in defaults, then user, then repository; lower ranks only add restrictions; an invalid rank-1 policy denies every privileged action), refusal by remote pattern, and managed-only rules. Nothing employer-specific enters the repository (SEC-7). Host limitation 4 (`allowManagedPermissionRulesOnly` semantics, `docs/containment.md:221`) stays documented as unverified, and no profile claims `enforced` for the rows it affects.
- **D-18:** **Existing data stays in place as `personal-local`.** The current layout already matches the per-profile roots. A ledger migration adds whatever profile scoping is needed, and existing records, including the portfolio's active record at `9f1cd8d`, belong to `personal-local` with an implicit binding. No owner-run migrate command. The migration fault tests cover it. — **Reversibility:** costly — a ledger schema migration that the backup and restore work in Phase 5 will depend on.
- **D-19:** **Fix the moved-root readability gap in this phase.** A profile whose roots were moved by environment variable must not be readable by other profiles' runs (`docs/system/containment.md:468`). AC-6 requires 0 cross-profile reads.
- **D-20:** **Host admission becomes a patch range inside a verified minor, guarded by a self-check at launch.** `ADMITTED_CLAUDE_VERSIONS` (`src/adapters/host-claude/launch-preflight.ts:24`) is replaced by a rule that admits any patch at or above the lowest verified patch within a verified minor (today 2.1.312 and up on 2.1.x). An unverified patch must pass the offline preflight probes at launch: settings keys honored, the sandbox probe, and the hook's fail-closed self-test. `doctor` labels it `admitted (unverified patch)`. A new minor (for example 2.2) or a failed probe still refuses until a live T3 containment run passes on it. Each admission is recorded in `test/containment/LIVE-CASES.md`. The installed 2.1.321 is admitted under this rule only if its probes pass. — **Reversibility:** reversible — one admission predicate. Its risk is a patch release that changes containment semantics without failing a probe, so the probes must cover every host behavior containment relies on.

### Carried forward (not re-decided)
- ADR-009 credentials: `delegated:`, `keychain:` and `cmd:` references only. `env:` is refused in every profile and fails `doctor` (S-49). Every lookup writes a `credential.resolve` event with no value, length or digest, and a resolved value seeds the redactor.
- Approvals (ADR-005, `docs/contracts-and-state.md:816-836`): actions are classed `read`, `local-write` or `privileged`, in a table in code. An approval is single-use, bound to the run, action and parameter digest, expires after 30 minutes by default, and is consumed in the transaction that starts the action. A contract that authorizes an action with its parameters is a valid source. Approving a plan approves no actions. Queued privileged actions never replay automatically (FR-15). The existing `approvals` table (`migrations/0001-initial.ts:76`) is the store.
- Retrieval (`docs/contracts-and-state.md:327-354`, `docs/containment.md:173-187`): `find` returns handles first, the assembler chooses within budget, and every pack lists what it omitted. Broad discovery needs `broadDiscovery: true` and is allowed once per run. Edge read rules come from a configuration table that the graphify relation spike fills, and an unmapped relation defaults to `id-only`. Caches record version, scope and profile, and are not reused after `denied` or `unauthenticated`.
- `doctor` (`docs/operations-and-testing.md:9-25`, `docs/extensions.md:379-408`): works offline, finishes in under 2 s, has `--json`, `--online` and `--repair`, prints no secrets, and reports the enforcement level `enforced`, `restricted` or `none`. After a GSD upgrade outside the adapter range, records are marked `incompatible` (S-38).
- Fake remote (`docs/operations-and-testing.md:155-157`, `docs/deployment-and-portability.md:140-150`): the `CommandExecutor` and `ArtifactStore` fakes serialize every call through JSON, add latency, drop 5% of responses and duplicate 2%. Both suites run the same compiled bundle. Domain code changes by 0 lines.
- Prior phases: `--json` shapes stay frozen, with optional keys appended only (Phase 2 D-19). The profile config holds user settings and a contract may only narrow them (Phase 3 D-21). Claude drafts exit inputs and the owner approves them before spend.
- **Documentation:** the phase's last plan is the `docs/system/` pass required by `CLAUDE.md` and SC6. It records every spec deviation decided here in `findings.md`: AC-8 baseline wording, `graphify update`, and the context budget and transcript resolutions if they deviate. Proposal docs are not edited to match the code. D-08's knowledge-pass outcome and D-20's admission rule each get an ADR.

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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope and acceptance
- `.planning/ROADMAP.md` (Phase 4) — goal, six success criteria, partial-coverage notes
- `.planning/REQUIREMENTS.md` — requirement text and traceability for the 28 IDs
- `docs/implementation-plan.md:62-66` — slice 3 deliverables and verification
- `docs/requirements.md` — AC-2, AC-5, AC-6, AC-7, AC-8 (`:237`), AC-14 (`:243`)

### Profiles, credentials, redaction, policy
- `docs/decisions/` ADR-005 (profiles pinned per run, approvals) and ADR-009 (credential provider broker)
- `docs/enterprise-adaptation.md:53-146` — repository binding, employer package, policy precedence `:67-106`, redaction `:129-130`, manual equivalents `:134-146`, contract-test package `:197`
- `docs/contracts-and-state.md:442-449` (credential.resolve), `:816-836` (approvals), `:845-854` (freshness), `:866-892` (import and the config file layout)
- `docs/operations-and-testing.md:115` (redaction suite), `:201` (S-9), `:406` (S-49)

### Retrieval
- `docs/contracts-and-state.md:327-354` — handle-first assembly, edge rules, edge-mapping table, S-54
- `docs/containment.md:173-187` — progressive steps and caps (illustrative)
- `docs/operations-and-testing.md:64-73` (resource bounds), `:151-153` (three-arm evaluation)
- `docs/system/indexes-and-context.md` — built context and graphify behavior

### Restricted mode, doctor, versions
- `docs/containment.md:153-161` (restricted mode), `:216-221` (host limitations 3 and 4)
- `docs/operations-and-testing.md:9-25` (doctor), `:269` (S-22)
- `docs/extensions.md:79`, `:379-408` (version table, enforcement levels, `--extensions`)
- `test/containment/LIVE-CASES.md` — admission record and spend log

### Brownfield adoption and refresh
- `docs/repository-onboarding.md:159-181` (promotion and mapping modes), `:262` (restricted onboarding), `:266-294` (existing-state migration, S-38), `:313` (graph update), `:350`
- `docs/operations-and-testing.md:331` (S-34), `:396` (S-47)

### Portability
- `docs/contracts-and-state.md:9-80` — Result, `unsupported`, capability descriptors, provider IDs
- `docs/deployment-and-portability.md:140-150`, `docs/operations-and-testing.md:155-157` — the fake-remote design

### Built-system docs and open findings
- `docs/system/README.md`, `docs/system/coverage.md`, `docs/system/findings.md` (`:24-25`, `:30`, `:41`, `:45-47`, `:75`, `:90`, `:217`, `:286`), `docs/system/containment.md:460,468`, `docs/system/config-reference.md`
- `.planning/milestones/v1.0-MILESTONE-AUDIT.md` — v1.0 tech debt. Items that bear on this phase but stay owned by Phase 9 unless a decision above pulls them in.
- `.planning/milestones/v1.0-phases/02-*/02-CONTEXT.md`, `.planning/milestones/v1.0-phases/03-*/03-CONTEXT.md` — carried-forward decisions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/adapters/fs/profile-paths.ts`: the per-profile root layout already exists (`AVARICE_CONFIG_HOME`, `AVARICE_DATA_ROOT`, `AVARICE_WORK_ROOT`), but `DEFAULT_PROFILE` is hard-coded. The config is written once and never read back (`src/adapters/fs/profile-config.ts` reads only `notify`).
- `src/domain/secret-patterns.ts`: `findSecrets` and `redactSecrets` are already used on check output and host transcripts. Not used on events (`src/adapters/sqlite/events.ts:59`).
- `src/ports/capability.ts`: `CapabilityDescriptor` includes `attributes.enforcement`. `src/domain/result.ts:7` has the `unsupported` error with `reducedMode`, and `unauthenticated{credentialRef}` at `:10`, which nothing produces yet.
- `src/ports/context-source.ts`: a handle-first `find`/`read` port with `readRule` and freshness. `src/app/context.ts` is the assembler (default 4000, maximum 100000). `gsd-intel` and `gsd-graph` adapters exist; `git-files` and `gsd-planning` are missing.
- The `approvals` table in `migrations/0001-initial.ts:76` is unused. `src/domain/amendment.ts` already lists `approvals` as something an amendment invalidates.
- `src/domain/preflight.ts`: `classifyExistingMap` already produces the ONB-6 classes.
- `src/adapters/host-claude/launch-preflight.ts`: the admission list and the offline probes that D-20's self-check builds on.
- `src/cli/identity.ts`: owner-terminal identity, reused for approval commands.
- `test/helpers/` fakes (`fake-agent-host`, `fake-graphify`, `fake-gsd-core`, `fake-run-host`, `offline`) are the base for the fake-remote adapters.

### Established Patterns
- Layers are `domain`, `ports`, `app`, `adapters` and `cli`, wired in `src/cli/composition.ts`. The import boundary is enforced by `scripts/check-boundaries.ts`, which today covers domain, ports and app.
- The TypeScript is run directly by Node 22.22.3 or later, with no runtime dependencies and tests under `node --test`. Test tiers: `unit`, `integration`, `fault`, `containment` (live with `AVARICE_LIVE=1`), `benchmark` and `mutation`.
- Budgets and overrides can only lower. Tables are insert-only and invalidation appends. `--json` keys are optional-append only.
- Version checks are spread out: the Claude allowlist, gsd-core via `runtime-identity`, graphify `--version`, and SQLite in `src/domain/runtime-support.ts`. Node is not checked. `doctor` consolidates them.

### Integration Points
- G0 and the host choice (`src/cli/composition.ts:148`, `src/app/run-stages/prepare.ts:359`, `src/app/stages/workspace.ts:122`) are where restricted mode and the capability-requirement checks branch.
- Onboarding registration (`src/app/stages/register.ts`) and `gsd-onboarding.ts:379` `init-planning` (which returns `unsupported` until Phase 4) are where adoption and refresh hook in.
- `src/app/run-stages/item.ts` is where the run's context pack is assembled, and where the D-13 budget applies.
- `adapter_configs` table: today only the host's descriptor is recorded, and `doctor` should read every adapter's descriptor.

</code_context>

<specifics>
## Specific Ideas

- The owner noted that the Claude Code patch releases admitted in Phases 1 to 3 differed very little, and that a live plan per patch was more friction than the risk justified. D-20 answers that.
- Use the portfolio (`~/aa-phan-portfolio-v2`, pin `9f1cd8d`) in both the AC-14 set and the evaluation task pool.

</specifics>

<deferred>
## Deferred Ideas

None. The discussion stayed within phase scope. The v1.0 tech-debt items not pulled in by D-14 and D-19 stay in Phase 9.

</deferred>

---

*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portability-proof*
*Context gathered: 2026-11-15*
