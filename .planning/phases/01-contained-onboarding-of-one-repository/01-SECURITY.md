---
phase: "1"
slug: "contained-onboarding-of-one-repository"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-04"
---

# Phase 1 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail. Register authored at plan time (the `<threat_model>` blocks of plans 01-01 to 01-26) plus the SUMMARY Threat Flags; verified at ASVS level 1 (grep-depth evidence) by gsd-security-auditor on 2026-11-04.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| User checkout → staging | Staging is a `clone --local --no-hardlinks` driven by safe git only; the checkout is never written | Committed content, refs, names of dirty paths (never their bytes) |
| AVARICE → contained Claude Code invocation | Generated settings, launch args, env allowlist, PreToolUse hook and Seatbelt sandbox confine a model-driven process | Onboarding contract, scoped paths, budgets; transcript back (redacted) |
| Repository content → model / graph / context output | Repository text, ADRs and documents are untrusted data and may carry injected instructions | Document text, graph nodes and edges, intel entries (fenced, `untrusted: true`) |
| AVARICE → GSD and graphify tools | Third-party tools located by version and run under the sandboxed executor with cwd = staging | Config, graph.json, intel files |
| Ledger and data root | Local single-user SQLite (WAL) and artifact store outside every `~/.claude*` location, 0700/0600 | Refs, digests, IDs, counts, bounded event data; no source bytes or secrets |
| Live spend | Live suites and exit runs spend model budget against an authorization file and caps | USD reservations and reported costs |

---

## Threat Register

| Threat ID | Plan | Category | Component | Severity | Disposition | Mitigation (evidence) | Status |
|-----------|------|----------|-----------|----------|-------------|------------------------|--------|
| T-01-04 | 01-01 | Tampering | scripts/check-boundaries.ts | medium | mitigate | check-boundaries.ts:223-242 dynamic-import, dynamic-require, create-require rules; test/unit/boundaries.test.ts:71-101 | closed |
| T-01-60 | 01-01 | Tampering | src/domain/onboarding-contract.ts | high | mitigate | onboarding-contract.ts:376-379 promotion other than none refused, :303 budgets only lowered; domain-contracts.test.ts RC-5 case | closed |
| T-01-SC | 01-01 | Tampering | npm installs (typescript, @types/node) | high | mitigate | package.json exact pins 7.0.2 and 22.20.5; package-lock.json:24,374 integrity; 01-01-SUMMARY.md:147 human checkpoint (user-recorded values not in repo) | closed |
| T-01-05 | 01-02 | Tampering | spikes/slice-0-wave-0/make-scratch.sh | high | mitigate | common.sh:28 assert_under_root; harness.sh:44,46; make-scratch.sh:44 `clone --local --no-hardlinks` | closed |
| T-01-06 | 01-02 | Denial of service (spend) | spikes/slice-0-wave-0/harness.sh | medium | mitigate | harness.sh:32 ledger gate; `--max-budget-usd` required; 0.4135 of 4.3 USD | closed |
| T-01-07 | 01-02 | Information disclosure | spike outputs | medium | mitigate | no transcripts tracked under spikes/; only fake FAKE-SECRET-123 in evidence | closed |
| T-01-SC | 01-02 | Tampering | npm/pip/cargo installs | high | mitigate | no install; versions recorded in results.json | closed |
| T-01-03 | 01-03 | Tampering | src/adapters/sqlite/ledger.ts | medium | mitigate | db.ts:189-193 BEGIN IMMEDIATE; ledger.ts:287-288 version and fence checks; 0001-initial.ts:131-143 triggers; ledger-status.test.ts:429,587,641 | closed |
| T-01-61 | 01-03 | Elevation | src/cli/main.ts dynamic command import | medium | mitigate | main.ts:11,25-26,52 COMMANDS allowlist, fixed `./commands/` URL, else exit 64 | closed |
| T-01-62 | 01-03 | Information disclosure | events.data_json | low | accept | see Accepted Risks AR-01; events.ts:11-12,46,55 size caps | closed |
| T-01-SC | 01-03 | Tampering | npm/pip/cargo installs | high | mitigate | no install; package files unchanged since b7dd72b | closed |
| T-01-01 | 01-04 | Elevation | src/adapters/git/safe-git.ts | high | mitigate | safe-git.ts:19-29 SAFE_GIT_ENV, argv-only spawnSync; no-repo-exec.test.ts:136,209 | closed |
| T-01-63 | 01-04 | Tampering | StagingWorkspace.read | medium | mitigate | staging-base.ts:239-290 realpath checks and size cap; staging-adapters.test.ts:183 | closed |
| T-01-64 | 01-04 | Elevation | src/adapters/host/unavailable-host.ts | high | mitigate | invoke returns unsupported; composition.ts:113-132; workspace.ts:120-127 | closed |
| T-01-SC | 01-04 | Tampering | npm/pip/cargo installs | high | mitigate | no install; package files unchanged | closed |
| T-01-02 | 01-05 | Elevation | src/cli/composition.ts | high | mitigate | composition.ts:111-132 contained adapter or UnavailableAgentHost only; skeleton.test.ts:256-267 | closed |
| T-01-65 | 01-05 | Tampering | stage ordering | high | mitigate | onboarding-service.ts:86-110 checkpoint before effect; skeleton.test.ts:178; killpoints.test.ts:150 | closed |
| T-01-66 | 01-05 | Information disclosure | preflight dirty paths | medium | mitigate | repo-facts.ts parseStatus names only; preflight.test.ts:244, unit preflight.test.ts:92 | closed |
| T-01-SC | 01-05 | Tampering | npm/pip/cargo installs | high | mitigate | no install; package files unchanged | closed |
| T-01-08 | 01-06 | Tampering | ledger.ts (leases) | high | mitigate | ledger.ts:242 fenced UPDATE, :288,298 fence checks; lease.test.ts:291 two-process race | closed |
| T-01-09 | 01-06 | Tampering | src/adapters/sqlite/migrate.ts | medium | mitigate | migrate.ts:54-64 checksum, :84 VACUUM INTO backup, :117 per-migration tx; migrations.test.ts | closed |
| T-01-10 | 01-06 | Repudiation | src/app/status.ts | low | accept | see Accepted Risks AR-02; status.ts:2 no lease, readOnly | closed |
| T-01-SC | 01-06 | Tampering | npm/pip/cargo installs | high | mitigate | no install; package files unchanged | closed |
| T-01-11 | 01-07 | Tampering | src/adapters/fs/profile-paths.ts | high | mitigate | profile-paths.ts:67-73; root-rules.ts:35-70; root-rules.test.ts | closed |
| T-01-12 | 01-07 | Tampering (data corruption) | src/adapters/fs/local-mount.ts | medium | mitigate | profile-paths.ts:77-83 refuses non-local root; local-mount.ts:1-4 heuristic limit; localfs.test.ts | closed |
| T-01-13 | 01-07 | Information disclosure | data root permissions | medium | mitigate | init.test.ts:79-88 0700/0600; db.ts:133,160; migrate.ts:80,85 | closed |
| T-01-SC | 01-07 | Tampering | npm/pip/cargo installs | high | mitigate | no install; package files unchanged | closed |
| T-01-14 | 01-08 | Elevation | src/adapters/git/safe-git.ts | high | mitigate | safe-git.ts:25-26 NOSYSTEM, :80-93 refuses `-c`/`--config-env`, :109-123 filters neutralized; no-repo-exec.test.ts:99-135 | closed |
| T-01-15 | 01-08 | Tampering | staging adapter vs user refs | high | mitigate | staging-strategy.ts:11 clone; staging-clone.ts:62; no-repo-exec.test.ts:227; checkout-unchanged.test.ts:32 | closed |
| T-01-16 | 01-08 | Information disclosure | src/adapters/git/repo-facts.ts | high | mitigate | repo-facts.ts:1-6 no file read; preflight.test.ts:256 secret absent | closed |
| T-01-17 | 01-08 | Tampering | ONB-6 existing state | medium | mitigate | preflight.ts:99-122 existing_state_conflict; preflight.test.ts:317,334 (residual race noted below) | closed |
| T-01-SC | 01-08 | Tampering | npm/pip/cargo installs | high | mitigate | no install; package files unchanged | closed |
| T-01-18 | 01-09 | Spoofing | src/adapters/gsd/locate.ts | high | mitigate | locate.ts:80-84 package name and 1.17.x; composition.ts:219 descriptor digest; gsd-adapter.test.ts:105,201,226 | closed |
| T-01-19 | 01-09 | Tampering | GSD verbs touching config.json | high | mitigate | gsd-onboarding.ts:117-121 cwd = staging; gsd-configure.test.ts:176-182 | closed |
| T-01-20 | 01-09 | Elevation | GSD verbs run by AVARICE | medium | mitigate | gsd-tools.ts:28-34 env allowlist, :87-99 sandboxed executor | closed |
| T-01-SC | 01-09 | Tampering | npm/pip/cargo installs | high | mitigate | no install; package files unchanged | closed |
| T-01-21 | 01-10 | Information disclosure | secret-patterns.ts, validate stage | high | mitigate | secret-patterns.ts:11-23; validate.ts:149-152 block, no retry; validation-failures.test.ts:172-206 | closed |
| T-01-22 | 01-10 | Elevation | src/domain/policy-narrowing.ts | high | mitigate | policy-narrowing.ts:1-12 narrow-only; activate.ts:32-52,146; record.test.ts:20-91 | closed |
| T-01-23 | 01-10 | Tampering | scope-of-writes check | high | mitigate | validate.ts:127-140 containment.finding; scope-and-validation.test.ts, validation-failures.test.ts | closed |
| T-01-24 | 01-10 | Tampering | project_records | medium | mitigate | ledger.ts:494-515 supersede and insert; 0001-initial.ts:131 trigger; ledger-status.test.ts:581-590 | closed |
| T-01-SC | 01-10 | Tampering | npm/pip/cargo installs | high | mitigate | no install; package files unchanged | closed |
| T-01-25 | 01-11 | Tampering | invocation-scope.ts + settings.ts | high | mitigate | invocation-scope.ts:229-253; settings.ts:84-108; invocation-scope.test.ts:65-200 | closed |
| T-01-26 | 01-11 | Elevation | host-claude/launch-args.ts | high | mitigate | launch-args.ts:103-155 assertLaunchArgsSafe; launch-args.test.ts:93-108 | closed |
| T-01-27 | 01-11 | Information disclosure | host-claude/env.ts | high | mitigate | env.ts:34-45 allowlist; invocation-env.test.ts:8-23; sec5.test.ts | closed |
| T-01-28 | 01-11 | Elevation | gsd/agent-frontmatter.ts | high | mitigate | agent-frontmatter.ts:21-22; agents-json.ts:26-31; agent-frontmatter.test.ts:181-193 | closed |
| T-01-29 | 01-11 | Elevation | Bash command identity | medium | mitigate | invocation-scope.test.ts:210; settings.ts:60-72; sandbox (T-01-36) | closed |
| T-01-30 | 01-11 | Tampering | host-claude/launch-preflight.ts | high | mitigate | launch-preflight.ts:59-70 (incl. strictAllowlist), :121-139, :155, :256-268; claude-host.test.ts:307-322,480-530 | closed |
| T-01-SC | 01-11 | Tampering | npm/pip/cargo installs | high | mitigate | no install; package files unchanged | closed |
| T-01-31 | 01-12 | Tampering | src/domain/hook-decision.ts | high | mitigate | hook-decision.ts:347-372 canonical path, unknown-tool deny; hook.test.ts:60-100 | closed |
| T-01-32 | 01-12 | Elevation | Bash identity rules | high | mitigate | hook-decision.ts:229-336 lexer, preamble sha256, expansion refused (MF-04); mutation/fail-closed.test.ts:200 | closed |
| T-01-33 | 01-12 | Denial of service (fail open) | src/hook/pre-tool-use.ts | high | mitigate | pre-tool-use.ts:33-41 exit 2 on any failure; hook.test.ts:186-258; launch-preflight.ts:177-227 self-test | closed |
| T-01-34 | 01-12 | Tampering | budgets | high | mitigate | pre-tool-use.ts:215-224 conditional UPDATE in BEGIN IMMEDIATE; budgets.test.ts:127,280 | closed |
| T-01-35 | 01-12 | Information disclosure | events written by hook | medium | mitigate | pre-tool-use.ts:232-241,270-281; hook.test.ts:446-451 | closed |
| T-01-SC | 01-12 | Tampering | npm/pip/cargo installs | high | mitigate | no install; package files unchanged | closed |
| T-01-36 | 01-13 | Elevation | exec/sandboxed-executor.ts | high | mitigate | seatbelt-profile.ts:56-78; sandboxed-executor.ts:118-126; executor.test.ts:92-263 | closed |
| T-01-37 | 01-13 | Tampering | graphify writing into staging | medium | mitigate | graphify.ts:169, :228-246 COPYFILE_EXCL, :318-341; graphify-tool.test.ts:113,154,166,180 | closed |
| T-01-SC | 01-13 | Tampering | npm/pip/cargo installs | high | mitigate | graphify only located and run; no install | closed |
| T-01-38 | 01-14 | Tampering | graph.json content | medium | mitigate | graph-validation.ts:50-70; index-code-graph.ts:77,86 | closed |
| T-01-39 | 01-14 | Denial of service | index build | low | accept | see Accepted Risks AR-03; graphify.ts:28 300 s timeout | closed |
| T-01-67 | 01-14 | Tampering | late staging writes | high | mitigate | activate.ts:99-133 final scope check; mutation/scope-and-validation.test.ts | closed |
| T-01-SC | 01-14 | Tampering | npm/pip/cargo installs | high | mitigate | no install; package files unchanged | closed |
| T-01-40 | 01-15 | Elevation | host-claude/claude-host.ts | high | mitigate | claude-host.ts:161, :181, spawn at :274 after both; claude-host.test.ts:307-322,480-530 | closed |
| T-01-41 | 01-15 | Tampering | invocation dir in the data root | high | mitigate | invocation-files.ts:63-76; settings.ts:91-108,143; pre-tool-use.ts:305-330; claude-host.test.ts:175-206 | closed |
| T-01-42 | 01-15 | Repudiation / spoofing | outcome classification | medium | mitigate | outcome.ts:1-17 facts only; outcome.test.ts:54-75 (question clause has no producer, see notes) | closed |
| T-01-43 | 01-15 | Information disclosure | transcript artifact | medium | mitigate | claude-host.ts:230-232 redactSecrets before put; claude-host.test.ts:278 | closed |
| T-01-44 | 01-15 | Denial of service | orphaned host process | medium | mitigate | claude-host.ts:274, :291-300, :355-398; resume.ts:22-73; claude-host.test.ts:347,554-575,650-666 | closed |
| T-01-SC | 01-15 | Tampering | npm/pip/cargo installs | high | mitigate | claude not installed by AVARICE; launch-preflight.ts:18,139 admitted versions | closed |
| T-01-45 | 01-16 | Tampering | live cases vs real repositories | high | mitigate | no target path in live harness; live-harness.ts:6-8 under $TMPDIR | closed |
| T-01-46 | 01-16 | Denial of service (spend) | live suite | medium | mitigate | live-onboarding.test.ts:22-25 AVARICE_LIVE gate; live-harness.ts:44,135-163 caps | closed |
| T-01-47 | 01-16 | Repudiation | verdicts | medium | mitigate | live-harness.ts:1-4 verdicts from tree, refs, ledger, host events | closed |
| T-01-SC | 01-16 | Tampering | npm/pip/cargo installs | high | mitigate | no install; package files unchanged | closed |
| T-01-48 | 01-17 | Tampering | intel invocation | high | mitigate | invocation-scope.test.ts:100; index-intel.ts:96-114; intel-step.test.ts:302 | closed |
| T-01-49 | 01-17 | Elevation (prompt injection) | src/app/context.ts | high | mitigate | context.ts:211-250 fencing; gsd-graph.ts:122-123; context.test.ts:300-329 | closed |
| T-01-50 | 01-17 | Information disclosure | context output | medium | mitigate | context.ts:211-250; gsd-graph.ts:47; index-knowledge.ts:200-207; knowledge-validation.ts:109-110 | closed |
| T-01-51 | 01-17 | Tampering (staleness) | gsd-graph adapter | medium | mitigate | freshness.ts:23-43; context.test.ts:274-295 | closed |
| T-01-SC | 01-17 | Tampering | npm/pip/cargo installs | high | mitigate | no install; package files unchanged | closed |
| T-01-52 | 01-18 | Elevation (prompt injection) | knowledge invocation | high | mitigate | invocation-scope.test.ts:108,130,150; settings.ts:136; knowledge-pass.test.ts:385-414 | closed |
| T-01-53 | 01-18 | Tampering (graph poisoning) | src/domain/graph-merge.ts | high | mitigate | graph-merge.ts:6-18; knowledge-validation.ts:100-107 and 2 KiB cap (MF-03); graph-merge.test.ts | closed |
| T-01-54 | 01-18 | Information disclosure | merged graph.json | high | mitigate | knowledge-validation.ts:109-110 at index-knowledge.ts:200,207 before install; knowledge-corpus.ts:81-87 | closed |
| T-01-55 | 01-18 | Denial of service | knowledge pass budget | low | accept | see Accepted Risks AR-04; knowledge-pass.test.ts:220-262 | closed |
| T-01-SC | 01-18 | Tampering | npm/pip/cargo installs | high | mitigate | no shell, no network in knowledge pass; graphify-tool.test.ts:219 | closed |
| T-01-56 | 01-19 | Tampering | target checkout | high | mitigate | checkout-digest.ts:56-97; 01-19-evidence-target.json checkoutUnchanged all true | closed |
| T-01-57 | 01-19 | Information disclosure | target `.env` | high | mitigate | invocation-scope.ts:234 denyRead; checkout-digest.ts:77-79 hashes only; preflight.test.ts:256 | closed |
| T-01-58 | 01-19 | Denial of service (spend) | exit runs | medium | mitigate | exit-run.sh:61-80 authorization file and cap | closed |
| T-01-59 | 01-19 | Elevation (prompt injection) | rehearsal injected ADR | high | mitigate | exit-run.sh:130-140; 01-19-evidence-rehearsal-6.json contractUnchanged true | closed |
| T-01-SC | 01-19 | Tampering | npm/pip/cargo installs | high | mitigate | no install; package files unchanged | closed |
| T-01-68 | 01-20 | Tampering | source tree during probing | high | mitigate | `git diff f88ca1e 9d6eb11 -- src` empty; 01-MUTATION.md:18 scratch clones | closed |
| T-01-69 | 01-20 | Tampering | test suite | high | mitigate | `git diff f88ca1e 9d6eb11 -- test` additions only, no skip added | closed |
| T-01-70 | 01-20 | Tampering (supply chain) | probe toolchain | medium | mitigate | 01-MUTATION.md:5,10 owner authorization, `--locked`, $TMPDIR (documentary) | closed |
| T-01-71 | 01-20 | Information disclosure | findings | low | accept | see Accepted Risks AR-05 | closed |
| T-01-SC | 01-20 | Spoofing | scope creep | low | accept | see Accepted Risks AR-06 | closed |
| T-01-72 | 01-21 | Tampering | orphaned intel and knowledge hosts (app/resume.ts) | high | mitigate | resume.ts:51 `reapStartedLaunches`, called at :156 before reconciliation and any stage; killpoints.test.ts:222 mid-invocation:intel and :knowledge cases | closed |
| T-01-73 | 01-21 | Elevation | session-ID reaper (`reapBySessionId`) | medium | mitigate | claude-host.ts:363 UUID-validated pattern (body moved verbatim); killpoints.test.ts:216-227 decoy with another session ID survives | closed |
| T-01-74 | 01-21 | Repudiation | launch rows left `started` | low | mitigate | resume.ts:73 marks `interrupted`; killpoints.test.ts:277-279 no `launch:%` row left `started` | closed |
| T-01-SC | 01-21 | Tampering | npm/pip/cargo installs | high | mitigate | no installs: package.json and package-lock.json unchanged since 97f32ad | closed |
| T-01-75 | 01-22 | Tampering | hostile `.gitignore` hiding staging writes (git/staging-base.ts) | high | mitigate | staging-base.ts:115 `--untracked-files=all --ignored=traditional`; repo-facts.ts:31-33 `!` read as untracked; ignored-writes.test.ts validate and activate cases | closed |
| T-01-76 | 01-22 | Denial of service | hostile `.gitignore` blocking own onboarding | low | accept | see Accepted Risks AR-07 | closed |
| T-01-77 | 01-22 | Information disclosure | ignored checkout file names in preflight facts | low | mitigate | repo-facts.ts:129 status without an ignored mode; ignored-writes.test.ts preflight facts case | closed |
| T-01-SC | 01-22 | Tampering | npm/pip/cargo installs | high | mitigate | no installs: package files unchanged | closed |
| T-01-78 | 01-23 | Information disclosure | reads outside the deny list (domain/hook-decision.ts readRule) | high | mitigate | hook-decision.ts:188-196 allow-list (staging, readRoots, allowRead) → `outside-read-set`; hook-policy.ts:51 canonical readRoots; hook-decision.test.ts and hook.test.ts P-3 cases | closed |
| T-01-79 | 01-23 | Information disclosure | recursive grep reaching secret globs or following links | high | mitigate | hook-decision.ts:387,403,406 `shell-recursive-read` (link-following flags incl. BSD -S/-O, denied root below, secret glob below) | closed |
| T-01-80 | 01-23 | Information disclosure | paths in attached option values or after `--` | high | mitigate | hook-decision.ts:430 `shell-option-value` fail closed; hook-decision.test.ts "shell option values, operands after --" suite | closed |
| T-01-81 | 01-23 | Information disclosure | residual reads via git objects and host Grep recursion | medium | accept | see Accepted Risks AR-08; named as known bypasses in docs/containment.md:107 | closed |
| T-01-SC | 01-23 | Tampering | npm/pip/cargo installs | high | mitigate | no installs: package files unchanged | closed |
| T-01-82 | 01-24 | Information disclosure | another onboarding's staging (domain/invocation-scope.ts denyRead) | high | mitigate | invocation-scope.ts:237-242 work root in denyRead, own staging in allowRead; invocation.ts:90 passes profile workRoot; claude-host.test.ts production-path case | closed |
| T-01-83 | 01-24 | Denial of service | work-root deny blocking own staging | medium | mitigate | settings.ts:50-52,100-104 `containsStaging` filter keeps the work root out of `Read(...)` denies; claude-settings.test.ts work-root case; live re-check is manual-only (01-VALIDATION.md) | closed |
| T-01-84 | 01-24 | Repudiation | docs/containment.md overclaiming CON-1 | medium | mitigate | docs/containment.md:107 CON-1 row names enforcement points, tests and known bypasses | closed |
| T-01-SC | 01-24 | Tampering | npm/pip/cargo installs | high | mitigate | no installs: package files unchanged | closed |
| T-01-85 | 01-25 | Repudiation | src/app/stages/index-knowledge.ts record `knowledge` | high | mitigate | knowledge-validation.ts:67-79 documentCoverage, :115-118 below half → validation-failed; index-knowledge.ts:225-226 re-validates the installed graph, :258-262 corpus, documentsExpected, dropped.unread from rechecked coverage; graph-merge.test.ts:347-406; knowledge-pass.test.ts:254-302,:320-329,:418-424 | closed |
| T-01-86 | 01-25 | Tampering | model writing document nodes for files it never read | medium | accept | docs/repository-onboarding.md:135 "covered" means a node cites the document; :111 document text is data; knowledge-validation.ts:129-136 document edges INFERRED/AMBIGUOUS only (S-46); AR-09 | closed |
| T-01-87 | 01-25 | Elevation | absolute `readPath`/`writePath` in .chunks.json | low | mitigate | knowledge-extraction.ts:82 normalizedAbsoluteRoot (normalized-root.ts:12-22) refuses relative, `/`, empty/`.`/`..` segment; hook-decision.ts:193 readConfine, :216 writeRoots; settings.ts:84-93; knowledge-extraction.test.ts:124-133; claude-host.test.ts:177-226 originals deny:outside-read-set | closed |
| T-01-88 | 01-25 | Tampering | knowledgePrompt carrying repository text or corpus root | high | mitigate | knowledge-extraction.ts:122-148 fixed text, field names only; index-knowledge.ts:158; knowledge-extraction.test.ts:152-159,:207-214; claude-host.test.ts:223-225 | closed |
| T-01-89 | 01-25 | Denial of service | retry-once instruction multiplying tool calls | low | mitigate | knowledge-extraction.ts:147 retry once then leave out; hook-decision.ts:476,480 + pre-tool-use.ts:190 per-call toolCalls charge; index-knowledge.ts:182-184 budget_exhausted; knowledge-extraction.test.ts:198-205; budgets.test.ts | closed |
| T-01-SC | 01-25 | Tampering | npm/pip/cargo installs | high | mitigate | package.json and package-lock.json unchanged 1f82604^..HEAD | closed |
| T-01-90 | 01-26 | Repudiation | scripts/assert-exit.ts | medium | mitigate | assert-exit.ts:97-99 finite() keeps absent null, :102 dropped.unread, :134-146 missing accounting and unread > 0 fail; exit-run-tools.ts:457-458 `assert-exit:` prefix; checkout-digest.test.ts:249-278,:326-330 | closed |
| T-01-91 | 01-26 | Tampering | mutation check on src/domain/knowledge-extraction.ts | medium | mitigate | `git diff --exit-code` clean; no src change in 2517625^..957f071; later change is IN-02 refactor 3c7ed2c; 01-26-SUMMARY:125-132 | closed |
| T-01-92 | 01-26 | Repudiation | docs/repository-onboarding.md | low | mitigate | :111,:135,:212 each map to knowledge-corpus.test.ts:248-255, claude-host.test.ts:177-226, graph-merge.test.ts:387-406, knowledge-pass.test.ts:254-318,:418-424, knowledge-extraction.test.ts:198-205 | closed |
| T-01-SC | 01-26 | Tampering | npm/pip/cargo installs | high | mitigate | package.json and package-lock.json unchanged 1f82604^..HEAD | closed |
| TF-01-15-A | 01-15 | Elevation (process spawn) | host-claude/claude-host.ts | medium | mitigate | SUMMARY flag; claude-host.ts:40,357 UUID regex before `pgrep -f --`; argv-only spawn | closed |
| TF-01-15-B | 01-15 | Tampering (scratch fs) | host-claude/launch-preflight.ts | low | mitigate | SUMMARY flag; launch-preflight.ts:177-227 mkdtemp 0700, copy 0600, rm in finally | closed |
| TF-01-16-A | 01-16 | Elevation (process spawn) | test/helpers/live-harness.ts | medium | mitigate | SUMMARY flag; test-only, AVARICE_LIVE gate and cap; live-admission-override.test.ts:75 | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

`T-01-SC` is a per-plan supply-chain row repeated in each plan's register; the plan column disambiguates it. The `TF-` rows are SUMMARY Threat Flags with no register ID.

### Notes on limited evidence (informational; no status change)

- **T-01-17:** `projects` lookup and `createOnboarding` are separate ledger calls (ledger.ts:205-217), so two simultaneous `onboard` runs of one repository could both create an onboarding. The lease still serializes stage execution per onboarding and the checkout is never touched. Closing the race needs a ledger method.
- **T-01-42:** the "model text stored fenced as `question` data" clause has no producer in Phase 1 (outcome.ts:17; agent-host.ts:62 `question?` never populated), so model text never reaches classification.
- **T-01-SC (01-01) and T-01-70:** human checkpoints are evidenced by SUMMARY, MUTATION and the lockfile only; not re-verifiable from code.
- **Recorded control limits:** the Seatbelt profile allows writes to `/private/var/folders` and `/private/tmp` and denies reads only for the data root and three credential directories (01-13); intel entries are model-written and unfenced, `--json` consumers must fence (01-17); immutability triggers do not stop a writer that drops them, the event hash chain makes tampering detectable (01-03).

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-01-62 | Phase 1 events carry IDs, counts, digests and exit codes only; the full redactor is Phase 4. events.ts caps strings at 1024 and JSON at 8192 | plan 01-03 threat model | 2026-11-04 |
| AR-02 | T-01-10 | `status` takes no lease, so a stale WAL snapshot can show a state up to one transaction old; it is labeled by the checkpoint time | plan 01-06 threat model | 2026-11-04 |
| AR-03 | T-01-39 | 300 s timeout per index command; a failure records the index absent and activation continues (ONB-13) | plan 01-14 threat model | 2026-11-04 |
| AR-04 | T-01-55 | Knowledge pass bounded by its wall-clock share and invocation and subagent budgets; a failure keeps the code-only graph and activation proceeds | plan 01-18 threat model | 2026-11-04 |
| AR-05 | T-01-71 | Mutation findings stay in the repository; nothing is published | plan 01-20 threat model | 2026-11-04 |
| AR-06 | T-01-SC (01-20) | The Target Units table bounds the mutation scope; other units are recorded as unprobed | plan 01-20 threat model | 2026-11-04 |
| AR-07 | T-01-76 | Unchanged write sets admit every AVARICE output under a `*` ignore (positive controls in ignored-writes.test.ts); a repository can only block its own onboarding | plan 01-22 threat model | 2026-11-04 |
| AR-08 | T-01-81 | Committed secret-glob files read through git objects (`git show`, `git log -p`) and host Grep recursion inside staging are outside the CR-02 cases (D-GAP-02); documented as known bypasses in docs/containment.md; transcripts redacted before storage | plan 01-23 threat model | 2026-11-04 |
| AR-09 | T-01-86 | Coverage counts what the graph claims: a document is covered when a pass-origin document node cites it, not when the model opened the file; nodes stay data with provenance and grant no authority (S-46); checking reads against coverage needs read targets in hook events, outside G-01-154. Stated in docs/repository-onboarding.md:135 | plan 01-25 threat model | 2026-11-05 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-04 | 94 | 94 | 0 | gsd-security-auditor (ASVS 1, block_on high) via execute-phase verify:post |
| 2026-11-04 | 111 | 111 | 0 | secure-phase re-audit for gap-closure plans 01-21..01-24 (17 new rows, ASVS 1 grep-depth short-circuit, no auditor spawn) |
| 2026-11-05 | 121 | 121 | 0 | gsd-security-auditor (ASVS 1, block_on high) for plans 01-25, 01-26; regression check of quick 261105-2i2 |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-04; re-verified 2026-11-05 (plans 01-25, 01-26)

## Security Audit 2026-11-04

| Metric | Count |
|---|---|
| Threats found | 17 |
| Closed | 17 |
| Open | 0 |

## Security Audit 2026-11-05

| Metric | Count |
|---|---|
| Threats found | 10 |
| Closed | 10 |
| Open | 0 |
