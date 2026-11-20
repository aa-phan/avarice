# Round 1, group B: doctor.md, portability.md, overview.md, README.md

Verdict: FAIL (1 BLOCKER, 8 WARNING, 9 NIT)

Reviewed digests (sha256, files as at HEAD 8c6eaa7):
- doctor.md 1c470bd3b734fc50029142f86883eaf354e403808fb2b002a880d2f77ac0a98d
- portability.md 8193c42f298b9ea605603489f8aabf4d1bc5b3448e366c4c8f390c55b4bdfa9b
- overview.md eb9d20789e89716b743559c7d7d424eab1705b8462f7caea1e05331a4e94c2c2
- README.md f87c3e38f2fe02b7ecc72c8bdb6ed56a4c79e19bb68de3e611e3dd38d175b466

Severity: BLOCKER = hard-rule violation or a claim the code contradicts or cannot support; WARNING = loosely supported claim, one-fact-one-home or length-cap defect; NIT = polish. This gate fails on any BLOCKER or WARNING.

## BLOCKER

### B1. portability.md, "The workflow proof", paragraph 2 (line 97): delivery history in prose
Claim: "The check lists the commits of the plan that built the proof, found by their commit subject ... It skips when that plan's base commit is not in the checkout's history."
Evidence: test/integration/portability-proof.test.ts:441-463 (PLAN_BASE, the subject grep on the plan tag). The description is accurate, but it describes the test through the delivery plan that built it, which CLAUDE.md and the house rules keep out of prose (plan references that describe how work was delivered).
Fix: state the property, not its delivery vehicle: "The proof's own commits are checked, by their subject line, to change no file under the source directory; the check skips in a checkout that lacks the commit range." Confidence: high that it is a plan reference; medium on whether the owner accepts a functional exemption.

## WARNING

### W1. overview.md, "System boundary", paragraph under the table (line 28): doctor "without changing anything"
Claim: "`doctor` diagnoses the profile without changing anything".
Evidence: src/cli/doctor-deps.ts:3-5 and doctor.md Quirks: doctor creates the profile directories and configuration file on first run, and `--repair` deletes orphaned `.tmp-` artifact files (src/adapters/diagnostics/probes.ts removeOrphanTemps). The two documents contradict each other; doctor.md is right.
Fix: "`doctor` diagnoses the profile and writes nothing except the profile's own directories and configuration file on a first run, and the orphan cleanup under `--repair` ([doctor.md](doctor.md))". Confidence: high.

### W2. doctor.md, "Host admission and enforcement" (line 78): process stated as an enforced fact
Claim: "A version joins the list only after a recorded live containment run on it with no failure."
Evidence: src/domain/host-admission.ts:7-9 holds the list as a constant; docs/system/containment.md:87 says "A version is meant to join the list only after a live containment run ... the code does not check that, it checks membership." doctor.md states the policy as if the code guaranteed it, and disagrees with the document that owns the rule.
Fix: drop the sentence (containment.md owns it) or hedge it exactly as containment.md does. Confidence: high.

### W3. doctor.md, "The command" Extensions paragraph (line 34) and findings table row `extensions`: "which skills it holds"
Claim: doctor reports "which skills it holds"; a finding for "a skill installed in more than one directory".
Evidence: src/adapters/diagnostics/probes.ts configDir(): only entries whose name starts with `avarice-` (directories, or links to directories) are listed. Other skills are never reported.
Fix: "which AVARICE skills (names starting `avarice-`) it holds", and "an AVARICE skill installed in more than one directory". Confidence: high.

### W4. doctor.md, one fact in two homes
(a) "Host admission and enforcement" repeats the verified list of six versions, the seven required flags and the refusal rules that docs/system/containment.md lines 77-87 already own (that file already links back to doctor.md for the labels). When the list changes, two documents must change. Fix: keep in doctor.md only what doctor adds (the four labels, the enforcement level, the attended label, the six restricted flags) and link containment.md for versions, required flags and refusal rules.
(b) "Quirks" restates the body in four of its six bullets: host-not-admitted-is-a-warning (also in "Findings"), doctor-creates-profile-files (also in "What it reads and what it never touches"), quick check can pass a corrupt index (also in "The report"), offline bound asserted by a test and not enforced (also in "What it reads ..."). Fix: delete the restatements; keep the proposal-versus-built bullet and the adapter-lag bullet. Confidence: medium-high (house rule: one fact, one home; no restatement for emphasis).

### W5. portability.md, capability table row `agent-host` (line 19)
Claim: "`contained-invocation`, `headless`, `resume` (false); a restricted host has `restricted-invocation` in place of the first".
Evidence: src/adapters/host-claude/claude-host.ts:131-152: `contained-invocation` is true when the readiness check passes and false otherwise, `headless` is true, `resume` is false. src/adapters/host/unavailable-host.ts:18-24 declares only `contained-invocation: false`. The "(false)" reads as applying to all three, and the `unavailable` adapter's smaller map is not stated. The restricted host also carries attribute `mode`, which the Attributes cell omits.
Fix: "`claude-code`: `contained-invocation` (true only when readiness passes), `headless` (true), `resume` (false); a restricted host declares `restricted-invocation` instead of the first; `unavailable`: `contained-invocation` (false) only". Add `mode` to the restricted host's attributes. Confidence: high.

### W6. Sentences over the 35-word hard cap (prose only, tables and code excluded)
- doctor.md line 7 (45 words): "Doctor exists to explain the problems that make the other commands refuse to start, so it runs when ..." Split at "so it runs".
- doctor.md line 13 (40): "A configured reference is shown as the reference it is, and a string that does not have the shape ..." Split at "so a secret".
- doctor.md line 34 (37): "For the Claude configuration directory in use, and for the default one when another is in use, ..."
- doctor.md line 106 (36): "The finding names the record, its version and revision, the reason, and the fix, which is ..."
- portability.md line 7 (41): "What the proof establishes is narrower than a remote deployment: the domain and application code ..." Split at the colon.
- portability.md line 11 (36): "It has a port name, an adapter name, a version, a map of capabilities ..." Use a list or two sentences.
- portability.md line 57 (37): "A provider's own identifiers are kept verbatim: a context reference from the intel index is ..."
- portability.md line 65 (37): "The server runs a command at most once and keeps the response text under the key until ..."
- portability.md line 97 (41): "The proof also checks that the faults were exercised: each seed dropped ..." (rewrite together with B1.)
- overview.md line 43 (48): "The dependency container carries, beside the ports, the selected profile (its name, class, ..." Split into the container's contents and the composition root's order of work.
Fix: split each. Confidence: high (counts by script, bold markers stripped; the 36 and 37 word cases may differ by one under another tokenizer, the others are over under any count).

### W7. portability.md, fake-remote variables table, row `AVARICE_TEST_REMOTE`
Claim: effect "Swaps the executor and the artifact store for the fakes".
Evidence: test/helpers/test-cli.ts: the swap happens only when the variable equals exactly `1`. Any other value does nothing. The same file throws when neither `AVARICE_DATA_ROOT` nor `AVARICE_TEST_REMOTE_ROOT` is set.
Fix: "Set to `1`, swaps ...". Confidence: high.

### W8. doctor.md, "Host admission and enforcement" opening (line 66): over-claim
Claim: "The `host` section answers whether a contained run could start, and why not when it could not."
Evidence: src/cli/composition.ts:228-262 (productionHost): a contained host also needs an admitted gsd-core and the GSD shim preamble in it; src/app/doctor.ts:384-396 computes `enforced` from admission, sandbox and a readable hook entry only. The host section can say `enforced` while a run still refuses (gsd absent, which the `gsd` section reports separately).
Fix: "answers whether the host side of a contained run could start (admission, sandbox, hook entry); the `gsd` section answers the GSD side". Confidence: medium-high.

## NIT

- N1. doctor.md "What it reads ..." paragraph 2: "Every probe that starts a process has its own 1-second timeout", yet the online authentication check has 8 seconds (stated two sections later; probes.ts ONLINE_TIMEOUT_MS). Say "every probe except the online authentication check".
- N2. doctor.md "Refusal rules": `host-version-unknown` cannot arise in the doctor path, because the pre-filter `VERSION_OUTPUT` (src/app/doctor.ts:230) only accepts output that starts with three numbers; the rule applies in the launch preflight. Say which path produces it.
- N3. doctor.md Quirks (bullet 4) and portability.md (closing line of "What the proof does not show", "the portability proposal"): the proposals are not named or linked. Name docs/operations-and-testing.md ("Diagnostics") and docs/deployment-and-portability.md ("Staging", slices 6a to 6d) once each.
- N4. portability.md "Capability descriptors": "Every adapter publishes a static descriptor." The executor and host descriptors are getters that run a probe on first read (sandboxed-executor.ts:120-130, claude-host.ts:131). Say the descriptor is built when first read.
- N5. portability.md "Fake-remote adapters": "a seeded latency of a few milliseconds" against "5 to 30 ms for the executor" later in the same document. State the numbers once.
- N6. portability.md heading "What the proof does not show" and doctor.md heading "What it reads and what it never touches" promise rather than name the content. Suggested: "Limits of the proof" and "Reads and writes".
- N7. overview.md repeats the fifteen-files and twelve-ports statement that portability.md owns (paragraph after the layer table). It links portability.md but also states the counts; keep one home.
- N8. README.md: the ADR-014 row maps only containment.md, but doctor.md carries the admitted-version list and the four admission labels; the extensions.md row maps doctor.md only "for version compatibility" while doctor.md also covers `--extensions` (extensions.md "Diagnosing conflicts and duplicates"). Widen both rows.
- N9. README.md and coverage.md: README says a document changed after review is `drafted`, but coverage.md line 80 lists README.md as `reviewed` although its tables changed in this phase (overview.md is correctly listed as changed after review). Update coverage.md in the documentation plan.

## Checked and not flagged (coverage)

- Dashes: no em dash, en dash or ` -- ` in any of the four files.
- Headings: sentence case in all four; no title-case headings.
- No changelog section or "last updated" field; the "drafted, not yet reviewed" marks on doctor.md and portability.md follow the README convention.
- Delivery history other than B1: none (no phase numbers, plan or threat IDs, SHAs, ticket keys). File paths appear only in the openings of doctor.md, portability.md and overview.md (allowed: modules named once in the opening).
- doctor.md facts verified against src/app/doctor.ts, src/cli/commands/doctor.ts, src/cli/doctor-deps.ts, src/adapters/diagnostics/probes.ts, src/domain/host-admission.ts: four flags and exit codes 0/3/64/70; usage line omits `--profile`; report key order; store states; the eleven finding areas and every row of the findings table; the six verified versions, the seven required and six restricted flags; the four labels; enforcement derivation; online statuses and 8 s timeout; repair rule (`.tmp-`, one hour, shard directories); record incompatibility's three cases and the `start` refusal (src/app/run-start.ts:196-236, exit 3); the 2 s offline test (test/integration/doctor.test.ts:110-118); quick check; adapter lag; the proposal example differences (docs/operations-and-testing.md:9-23).
- portability.md facts verified: fifteen port files, twelve adapter ports, every other capability-table row against the adapters' descriptors; the twelve step requirements and reduced modes (src/domain/capability-requirements.ts); which steps are checked (only `run.unit` and `onboarding.map.*`, so the "six never checked" quirk holds); `enforcement_failure` and `scope_unavailable` block reasons; extension naming rule and its test; fake retry bounds (six and three), drop 5%, duplicate 2%, latency ranges, seeds, three contract seeds, the 11 and 10 contract cases, the four variables and their defaults, and the production-ignores check (portability-proof.test.ts:465-480). `adopt-map` true in the GSD adapter is right; the code comment at capability-requirements.ts:46 saying no adapter declares it is stale, an unrelated defect not reported against the documents.
- overview.md facts verified: twenty commands (src/cli/commands), five owner commands and the commands that refuse inside a run (`comment` is read-only and not claimed), fifteen port files, the lint rules (scripts/check-boundaries.ts), the network and detach confinement (test/unit/footprint.test.ts), supervisor spawn reachable from `start`, `decide` and `resume` only, hand-off writes one new branch ref only, `repo add --profile` binding, production-host rule (src/cli/composition.ts), shell opening rule and exit 64, broker with no caller.
- README.md: the documents table lists every file in docs/system (plus diagrams); every linked proposal and ADR file exists in docs/ and docs/decisions/; all 14 proposal documents in docs/ appear in the counterparts table; ADR-006 is still `Proposed`; the nine flows of processes.md match; the broker note holds. The counterparts table names files, not sections, so no section anchor can be wrong.

Run hygiene: this review wrote only this file; version-control status shows no other change from the run.

Verdict: FAIL
