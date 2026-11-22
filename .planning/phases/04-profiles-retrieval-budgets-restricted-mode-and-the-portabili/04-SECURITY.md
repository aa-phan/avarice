---
phase: "04"
slug: "profiles-retrieval-budgets-restricted-mode-and-the-portabili"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
threats_open_below_threshold: 2
asvs_level: 1
block_on: high
register_authored_at_plan_time: true
created: "2026-11-22"
---

# Phase 04 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail. Register parsed from the `<threat_model>` blocks of the 39 phase plans; each mitigation verified against code and tests by `gsd-security-auditor` (ASVS L1, block_on high) on 2026-11-22. Report-only run: no code, tests or docs were changed.

---

## Trust Boundaries

Consolidated from the plans' threat models (one row per boundary class).

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| command line, environment, bindings and enterprise config -> profile selection | `--profile`, `AVARICE_PROFILE`, `bindings.json` and enterprise files steer which store opens | untrusted selectors |
| profile A roots -> profile B processes | must not cross | another profile's files and stores |
| organization, user and repository policy files -> evaluator | ranked sources; lower ranks may only restrict; rank 1 may be missing or corrupt | authority |
| agent, run and retrieved text -> approvals | must not cross; the owner terminal is the only human source of an approval | approval authority |
| agent and subagent tool calls -> hook | untrusted commands and search requests from the model | shell commands, retrieval requests |
| Keychain, helper processes, vendor CLIs -> AVARICE | secrets cross into the process | credential values |
| AVARICE -> events, artifacts, transcripts, logs, doctor output | secrets must not cross | redacted text |
| repository content, planning files, graph and intel indexes, owner-supplied files -> context pack | untrusted text, model-inferred nodes | fenced untrusted data |
| brief file and indexes -> resumed run; interrupted process -> resume | inputs that change while parked; half-started privileged actions | refs, digests, privileged steps |
| restricted invocation -> disposable clone | the only writable place in restricted mode | file writes |
| retrieval sources -> assembler; contract and profile config -> caps | large or slow responses; contract only narrows | budgeted retrieval |
| adapter descriptors -> step start | a step trusts the descriptor's capability claims | capability flags |
| environment and spend ledger -> live harness; drafts -> live spend; public repositories -> graphify | live spend steering and untrusted code in scratch directories | spend, benchmark inputs |

---

## Threat Register

105 unique threats: 102 mitigate, 3 accept. 103 closed; 2 open below the `high` block threshold (non-blocking).

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-04-01 | Denial of service | live spend runaway | high | mitigate | 40 USD ceiling checked before every case; env override lower-only; tested | closed |
| T-04-02 | Tampering | corrupt ledger reads as zero spend | medium | mitigate | a non-JSON line throws; tested | closed |
| T-04-SC | Tampering | npm/pip/cargo installs | high | mitigate | No package installs in this plan | closed |
| T-04-03 | Tampering | cloned public repositories executing code | medium | mitigate | clone only; no install, build or script run; graphify parses with tree-sitter; clones live outside this checkout and are deleted after | closed |
| T-04-04 | Information disclosure | spike records quoting home paths | low | accept | spike records are repository files; paths under the owner's home are the same ones RESEARCH already records | closed |
| T-04-05 | Information disclosure | private repository content copied into this repository | medium | mitigate | the lists hold paths, SHAs, commit subjects and test paths only, never file content; the owner reviews them at the checkpoint | closed |
| T-04-06 | Tampering | held-out test leaking into an arm | high | mitigate | heldOutTest excluded from allowedReads, asserted by the shape test; plan 04-31 builds indexes at the parent | closed |
| T-04-07 | Information disclosure | wrong profile opens another profile's store | high | mitigate | selection decided before createDeps; mismatch exits 3 with no store opened; tested by file absence (S-9) | closed |
| T-04-08 | Tampering | profile name path traversal (../) or planted symlinked bindings file | high | mitigate | strict name grammar; O_NOFOLLOW, regular file, size cap; temp-and-rename writes, 0600 | closed |
| T-04-09 | Elevation of privilege | enterprise repository silently run under a personal profile | medium | mitigate | remotePatterns scan of enterprise configs, refusal never re-binds | closed |
| T-04-10 | Elevation of privilege | repository or user rule loosening an organization rule | high | mitigate | rank order and enterprise add-only rule in evaluatePolicy; tested | closed |
| T-04-11 | Tampering | missing or corrupt rank-1 file read as permissive | high | mitigate | invalid or absent rank 1 under enterprise denies every privileged action; tested | closed |
| T-04-12 | Elevation of privilege | injected text acting as policy | high | mitigate | closed PolicySources type with four fields; no evaluator input takes retrieved text | closed |
| T-04-13 | Information disclosure | employer data committed | medium | mitigate | footprint guard on profile names and hosts | closed |
| T-04-14 | Spoofing | a step running on an adapter that cannot do it and reporting success | medium | mitigate | requireCapabilities before every listed step; false equals absent; tested | open — below high threshold (non-blocking): requireCapabilities is called only for run.unit (src/app/run-stages/prepare.ts:394) and onboarding.map.* (src/app/stages/workspace.ts:166); run.check, run.handoff, run.install, onboarding.stage, onboarding.index.graph and onboarding.planning.init are declared (src/domain/capability-requirements.ts:47-69) but no stage checks them. Already in docs/system/findings.md:274 |
| T-04-15 | Repudiation | a control documented without its bypass | low | mitigate | enforcement map test requires enforcer and bypass on every row | closed |
| T-04-16 | Information disclosure | secret-shaped string persisted in an event | high | mitigate | redactLeaves before boundedEventJson in the one appendEventRow both writers use; tested from ledger and hook | closed |
| T-04-17 | Tampering | redaction changing the hash chain inconsistently | medium | mitigate | redact before hashing so row_hash covers stored text; chain recomputed in test | closed |
| T-04-18 | Denial of service | over-redaction of digests and IDs breaking evidence | low | mitigate | unit cases for digests, ULIDs, paths; seeded literal minimum length | closed |
| T-04-19 | Information disclosure | a store opened under the wrong profile | high | mitigate | meta.profile_id assertion after migrate; refusal tested | closed |
| T-04-20 | Tampering | approvals rows edited or deleted to replay an approval | high | mitigate | approvals_no_delete and approvals_update_guard triggers; tested | closed |
| T-04-21 | Tampering | config.json with unknown or hostile keys | medium | mitigate | closed key set, typed sections parsed by their owners, O_NOFOLLOW and size cap | closed |
| T-04-22 | Denial of service | interrupted migration leaves a mixed schema | medium | mitigate | one transaction per migration with backup first; fault test | closed |
| T-04-23 | Denial of service | unbounded descendant expansion | medium | mitigate | depth bound 3 and the excerpt cap; budget picks first-fit | closed |
| T-04-24 | Elevation of privilege | model-inferred reference edges pulling in instruction text | medium | mitigate | reference and unmapped relations are id-only; untrusted marking kept | closed |
| T-04-25 | Tampering | user edits overwritten by regeneration | high | mitigate | all regeneration in staging; checkout treeDigest unchanged in every test; userOwned recorded | closed |
| T-04-26 | Spoofing | a forged stamp making a stale map adoptable | medium | mitigate | adoption needs GSD's drift pass in staging, not the stamp alone | closed |
| T-04-27 | Elevation of privilege | `--paths` argument injection | medium | mitigate | paths validated and passed as one comma-separated argv value, never through a shell | closed |
| T-04-28 | Elevation of privilege | a patch that changes containment semantics without failing a probe | high | mitigate | sandbox probe and hook fail-closed self-test on every launch; flag-presence probe; new minor refuses; residual risk recorded in ADR-014 and closed by the live canary in plan 04-34 | closed |
| T-04-29 | Spoofing | lexical version comparison admitting the wrong version | medium | mitigate | numeric per-component compareVersions; tested | closed |
| T-04-30 | Information disclosure | moved profile roots readable to another profile's run | high | mitigate | knownProfileRoots feeds denyRead of host settings and executor; proven through sandbox-exec | closed |
| T-04-31 | Tampering | supervisor opening the default profile instead of the selected one | high | mitigate | AVARICE_PROFILE in supervisorEnv and launchd; store profile assertion refuses a mismatch | closed |
| T-04-32 | Tampering | planted config.json under profiles/ steering denies | low | mitigate | O_NOFOLLOW read, name grammar check; a planted file can only add denies, never allows | closed |
| T-04-33 | Denial of service | status unusable with many runs | medium | mitigate | batched reads, indexes, constant statement count guard, bench gate | closed |
| T-04-34 | Tampering | IN-list SQL built from IDs | low | mitigate | bound parameters only, chunked placeholders; IDs come from the ledger | closed |
| T-04-35 | Elevation of privilege | a paths refresh reading outside its scope | medium | mitigate | contract files.read narrowed to scope plus .planning/**; the hook's read rule enforces it; asserted in S-34 | closed |
| T-04-36 | Tampering | crafted path names in changed paths | low | mitigate | paths come from git output through runGit, validated before reaching `--paths` | closed |
| T-04-37 | Information disclosure | credential value in an event, artifact or log | high | mitigate | value-free credential.resolve; handle exposes the value only inside use(); redactor seeded before return; dump test | closed |
| T-04-38 | Elevation of privilege | arbitrary helper execution through cmd: | high | mitigate | helper must be in credentials.helpers; argv only; sandboxed executor; scrubbed environment; timeout | closed |
| T-04-39 | Spoofing | env: or an unapproved provider used as a source | medium | mitigate | grammar refuses env:; class allow-list; composition refuses an env: reference | closed |
| T-04-40 | Information disclosure | secret in a process argument list | medium | mitigate | the service name is the only argument; the value arrives on stdout only | closed |
| T-04-41 | Elevation of privilege | approval reused for other parameters or another run | high | mitigate | match on scope, action and canonical digest; tested | closed |
| T-04-42 | Elevation of privilege | approval consumed twice under a race | high | mitigate | consume and start in one BEGIN IMMEDIATE transaction; 0004 update guard; race test | closed |
| T-04-43 | Spoofing | approval granted from inside a run or a script | high | mitigate | refuseOutsideTerminal before the profile resolves; AVARICE_RUN and process-tree checks | closed |
| T-04-44 | Repudiation | replayed privileged action after a crash | high | mitigate | reconcilePrivilegedSteps opens a decision; no replay path exists; fault test | closed |
| T-04-45 | Tampering | stale or orphaned nodes after a merge misleading later packs | medium | mitigate | merge drops changed and deleted files' nodes and edges; equality with a full rebuild tested | closed |
| T-04-46 | Elevation of privilege | phase files with instructions treated as authority | medium | mitigate | phase files are document nodes, fenced as untrusted data in packs (S-46); no policy source | closed |
| T-04-47 | Information disclosure | secret split by the 20 MiB cap stored | high | mitigate | line-wise redaction before counting; cap at a line boundary; tested with a lowered cap | closed |
| T-04-48 | Information disclosure | whole tool payloads retained by default | medium | mitigate | summary plus digest by default; whole transcript on explicit opt-in only | closed |
| T-04-49 | Information disclosure | context pack or manual evidence storing a secret | high | mitigate | RedactingArtifactStore on every text kind; composition always wraps | closed |
| T-04-50 | Elevation of privilege | privileged effect by the agent without approval | high | mitigate | classification before prefix rules; deny with request; approvals consumed only in attended mode; run prefix denials unchanged | closed |
| T-04-51 | Elevation of privilege | injected text claiming approval | high | mitigate | approvals only from `avarice approve` rows; hook reads no text; test with a hostile brief and ADR | closed |
| T-04-52 | Tampering | install-host clobbering the owner's settings | medium | mitigate | marker-scoped replacement, symlink refusal, temp-and-rename, preservation test | closed |
| T-04-53 | Elevation of privilege | obfuscated shell bypassing classification | medium | accept | documented bypass (ADR-005, enforcement map); sandbox network and credential denial and the SCM platform remain authoritative | closed |
| T-04-54 | Tampering | brief edited while a run waits, then executed silently | high | mitigate | brief recorded by digest; resume refreshes and blocks with ref_changed before delegation; S-5 test | closed |
| T-04-55 | Information disclosure | revoked source still feeding packs | medium | mitigate | access_revoked blocks the run; plan 04-28 purges cached excerpts for that ref | closed |
| T-04-56 | Tampering | promotion overwriting user files | high | mitigate | absent or byte-identical only; anything else becomes a decision; treeDigest tests | closed |
| T-04-57 | Elevation of privilege | promotion without authority | high | mitigate | authorizeAction with the contract source and policy; enterprise deny tested | closed |
| T-04-58 | Tampering | commit moving user refs or HEAD | high | mitigate | create-only fetch of one avarice/onboard-* ref; refsDigest test | closed |
| T-04-59 | Information disclosure | a cross-profile read missed by unit tests | high | mitigate | end-to-end suite with deny sandbox and canaries | closed |
| T-04-60 | Information disclosure | a persistence boundary missed by redaction | high | mitigate | full dump and file scan with positive controls | closed |
| T-04-61 | Information disclosure | a real secret committed in test fixtures | medium | mitigate | corpus generated from fixed seeds at test time; footprint and secret scans pass | closed |
| T-04-62 | Elevation of privilege | restricted run escaping to code execution | high | mitigate | --restricted removes code-running tools; no Bash in the launch line; restricted preflight; argv asserted | closed |
| T-04-63 | Tampering | restricted run writing the user's repository | high | mitigate | disposable clone; no hand-off; refsDigest and treeDigest tests | closed |
| T-04-64 | Elevation of privilege | silent fallback to unrestricted on resume | high | mitigate | mode stored in the contract; resume dispatches on it; kill-and-resume test | closed |
| T-04-65 | Spoofing | a restricted map presented as complete | medium | mitigate | completeness partial plus restricted key and label; contained start refused on it | closed |
| T-04-66 | Tampering | restricted mapper writing outside staging | high | mitigate | --restricted confines file tools to the working directory (staging); checkout treeDigest test; live proof in plan 04-34 | closed |
| T-04-67 | Information disclosure | secrets in doctor output | high | mitigate | references only, never resolution offline; process redactor and stripping on every line; scan test | closed |
| T-04-68 | Tampering | doctor mutating state while diagnosing | medium | mitigate | read-only composition, no migration, no lease; --repair limited to old temp files; row counts asserted | closed |
| T-04-69 | Denial of service | a hung probe stalling doctor | low | mitigate | 1 s timeout per probe; 2 s total asserted under the offline wrapper | closed |
| T-04-70 | Spoofing | incompatible GSD reinterpreting a record | medium | mitigate | derived incompatibility refuses start (S-38); record untouched | closed |
| T-04-71 | Elevation of privilege | search term as git option injection | medium | mitigate | term passed after -e with --fixed-strings through runGit; global options refused | closed |
| T-04-72 | Information disclosure | search outside the contract read scope | medium | mitigate | path specs limited to the read paths; out-of-scope hit test | closed |
| T-04-73 | Elevation of privilege | planning text treated as instruction | medium | mitigate | sections fenced untrusted (S-46); not a policy source | closed |
| T-04-74 | Spoofing | an agent recording fake evidence | high | mitigate | run refusal before the profile resolves; the hook already denies avarice in runs; manual evidence never satisfies a gate | closed |
| T-04-75 | Information disclosure | pasted CI logs holding tokens | medium | mitigate | RedactingArtifactStore on manual kinds; redaction suite rerun | closed |
| T-04-76 | Elevation of privilege | pasted excerpt instructing the agent | medium | mitigate | included fenced as untrusted; not a policy source | closed |
| T-04-77 | Denial of service | unbounded retrieval cost or size | medium | mitigate | per-step caps, byte cap, timeout and abort, page cap; tested | closed |
| T-04-78 | Tampering | counters drifting under concurrency | medium | mitigate | atomic budget-row reservation; six-process race test | closed |
| T-04-79 | Information disclosure | cached excerpt reused after revocation or across profiles | high | mitigate | mayReuse rule, profile and scope stamped on items, revoked refs purged | closed |
| T-04-80 | Denial of service | unbounded agent searching | medium | mitigate | retrieval.searches reserved atomically with toolCalls; race test | closed |
| T-04-81 | Information disclosure | unauthorized broad discovery | medium | mitigate | unfiltered root searches gated on the contract flag, once per run | closed |
| T-04-82 | Denial of service | disk filled by artifacts or output | medium | mitigate | artifact quota and per-stream capture cap with defined failure | closed |
| T-04-83 | Repudiation | evidence stored without its output when space runs out | medium | mitigate | the check stage fails instead; tested | closed |
| T-04-84 | Tampering | event bound used to drop audit events | low | mitigate | only debug events are refused; info and above always written; counted and reported | closed |
| T-04-85 | Tampering | answer leakage into an arm | high | mitigate | indexes built at the parent; held-out test added only in the judging clone; tested | closed |
| T-04-86 | Denial of service | evaluation spend overrun | high | mitigate | per-run cap, ceiling check before every run, dry-run projection, unapproved list refused | closed |
| T-04-87 | Repudiation | verdict computed by hand | low | mitigate | pure verdict and knowledgeRule functions with unit tests | closed |
| T-04-88 | Tampering | a swapped artifact store bypassing redaction | medium | mitigate | composition wraps any override in the RedactingArtifactStore | closed |
| T-04-89 | Spoofing | an adapter claiming capabilities it lacks | low | accept | descriptors are static code reviewed with the adapter; contract tests in plan 04-33 exercise the claims | closed |
| T-04-90 | Tampering | duplicated command execution after a dropped response | medium | mitigate | query by invocation key; inner executor call log asserted unique | closed |
| T-04-91 | Elevation of privilege | the test seam reachable in production | medium | mitigate | AVARICE_TEST_REMOTE read only by test/helpers/test-cli.ts; bin/avarice.ts never passes overrides (footprint scan of src for the variable name) | closed |
| T-04-92 | Elevation of privilege | a containment failure on the installed patch | high | mitigate | 22 admission cases before verification; any failure halts and refuses admission | closed |
| T-04-93 | Denial of service | live spend overrun | high | mitigate | owner-authorized group cap, per-case caps, ceiling check before each case | closed |
| T-04-94 | Repudiation | a live failure silently retried | medium | mitigate | D-04 classification and the two-failure stop rule; verdict log | closed |
| T-04-95 | Tampering | onboarding changing a benchmark checkout | high | mitigate | before and after checkout and refs digests per repository; verify fails on any change | closed |
| T-04-96 | Denial of service | spend overrun | high | mitigate | owner authorization in their terminal, per-repository and group caps, ceiling check | closed |
| T-04-97 | Elevation of privilege | prompt injection in a public repository | medium | mitigate | contained onboarding (sandbox, hook, read-only source); fenced document nodes; live result recorded | closed |
| T-04-98 | Denial of service | evaluation spend overrun | high | mitigate | owner authorization, pilot-measured projection, conditional cap, ceiling check per run | closed |
| T-04-99 | Repudiation | a verdict that leaked the answer | high | mitigate | indexes at the parent and held-out tests only in the judging clone (plan 04-31 tests) | closed |
| T-04-100 | Repudiation | a document describing proposal behaviour as built | medium | mitigate | written from the code with the legacy-documentation skill; fresh review in plan 04-39 | closed |
| T-04-101 | Information disclosure | a real path, credential or employer name in documents | low | mitigate | examples use reserved names; footprint guard covers docs | closed |
| T-04-102 | Repudiation | stale documentation of a security control | medium | mitigate | every changed control surface rewritten from the code; fresh review in plan 04-39 | open — below high threshold (non-blocking): containment.md, data-model.md and integrations.md failed four fresh-review rounds (04-39-reviews/round-1-C.md..round-4-C.md); owner ruled "close drafted" 2026-11-22; post-round-4 fixes not re-reviewed; coverage.md marks them "changed after review" |
| T-04-103 | Repudiation | a document marked reviewed without a passing review | medium | mitigate | coverage status set only after a recorded passing round | closed |
| T-04-104 | Tampering | proposal documents edited to match the code | medium | mitigate | the docs diff check in Task 3; deviations go to findings.md | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

### Auditor notes on closed threats

- T-04-06: `allowedReads` is `['**']`; the real control is `heldOutTest` always added to `deniedReads` (`scripts/eval-retrieval.ts:153`) plus `assertNoLeak` removal from the arm workspace (`:437-456`), not literal exclusion from `allowedReads`.
- T-04-05: a brief carries the full commit message (subject and body), not the subject only; owner-approved deviation (`04-03-SUMMARY.md`, Deviations item 2).
- T-04-53: the obfuscated-shell bypass is named in `src/domain/privileged-commands.ts:8-11`, `src/domain/enforcement-map.ts:91-97`, `docs/system/policy-and-approvals.md:133`; ADR-005 itself does not name it although the code comment cites ADR-005.
- T-04-82: the artifact quota counts only the current process's writes (known limit, recorded in `src/adapters/fs/artifact-store.ts:59`).
- T-04-101: the footprint host scan (`test/unit/footprint.test.ts:446`) covers src, scripts, bin and test, not docs; a manual grep of `docs/system` found no home paths, foreign hosts or secret patterns.

---

## Accepted Risks Log

Dispositions accepted at plan time; rationale verified as documented in the repository by the auditor.

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-04-01 | T-04-04 | Spike records are repository files; the home paths they quote are already recorded in RESEARCH (`04-02-PLAN.md:158`) | plan 04-02 threat model | 2026-11-16 |
| AR-04-02 | T-04-53 | Obfuscated shell can bypass privileged-command classification; documented bypass (enforcement map, `docs/system/policy-and-approvals.md:133`); sandbox network and credential denial and the SCM platform remain authoritative | plan 04-19 threat model | 2026-11-16 |
| AR-04-03 | T-04-89 | Adapter descriptors are static code reviewed with the adapter; contract tests (`test/contract/local.test.ts`, `fake-remote.test.ts`) exercise the claims | plan 04-32 threat model | 2026-11-16 |

The two open medium threats (T-04-14, T-04-102) were NOT accepted in this run: accepting is an owner decision, and this was a report-only audit.

---

## Unregistered Threat Flags

Flags raised by SUMMARY `## Threat Flags` sections or found during verification that map to no register entry.

1. **WARNING — committed live-evaluation transcripts on a public repository (04-36).** `.planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-36-evidence/` is committed (278 files, about 45 MB, 126 transcripts; commit 4afbcaa). The transcripts hold tool-result text from the owner's private portfolio repository; secret patterns are redacted, repository source is not. The commit is on no remote branch, and `origin` (`aa-phan/avarice`) is PUBLIC, so pushing this branch for the phase PR would publish that content. Same class as T-04-05 but outside its scope. Owner decision needed before any push: keep, trim, or remove from history.
2. Informational (04-34): `src/adapters/git/staged-specs.ts` writes `.claude/gsd-core/` into the staging tree; guarded by `lstat` and symlink refusal (`:46,71-72,111`), mode 0444 (`:19`), removal on return (`:77,93`) and a repository-ownership marker (`:4`); tested in `test/integration/staging-adapters.test.ts:225`.
3. Informational (04-21): onboarding carrier-run decision rows are easy to miss in the inbox.
4. Informational (04-25): doctor probes read files and spawn processes; bounded and consistent with T-04-67..T-04-69.
5. The SUMMARY files for 04-02, 04-11 and 04-13 have no `## Threat Flags` section.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-22 | 105 | 103 | 2 (medium, non-blocking) | gsd-security-auditor (sonnet), orchestrated by gsd-secure-phase |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed (at block_on high)
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-22 (threats_open: 0; T-04-14 and T-04-102 open below threshold; unregistered flag 1 needs the owner before any push)
