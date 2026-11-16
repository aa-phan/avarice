Reviewed: docs/system/findings.md sha256 be416f7b2097a09c6f852f25d29afd76cf0d57490eb42eb9f2bdef6a7012ac45 at 6b82da29e8f2c8b5324bd4442546c7ececde29ce
Verdict: BLOCKED: 0 BLOCKER, 5 WARNING, 3 OBS. Several added or retained lines cite a file:line that does not carry the claim.

BLOCKED: 0 BLOCKER, 5 WARNING, 3 OBS. Several added or retained lines cite a file:line that does not carry the claim.

Digest reviewed: be416f7b2097a09c6f852f25d29afd76cf0d57490eb42eb9f2bdef6a7012ac45 (matches the dispatch).
Scope: `git diff 72a86b1..HEAD -- docs/system/findings.md` (about 150 added lines, 154 distinct file:line citations, each opened at HEAD).

## Findings (most severe first)

W1. WARNING (high). Cited lines do not say what is claimed.
Location: "From runs", `src/domain/conventions.ts:243` note: "`docs/system/config-reference.md:74` to `:77` list `paths.read`, `paths.generated`, `commands` and `verificationByChangeType`".
Evidence: docs/system/config-reference.md:74-77 are the `schema`, `profile`, `dataRoot`, `workRoot` dead-knob rows. The keys are at config-reference.md:159, 160, 162 and the sentence naming the run reader's refusals is at :169.
Fix: cite `docs/system/config-reference.md:159` to `:162` and `:169`.

W2. WARNING (high). Cited line does not carry the claim.
Location: "From containment (run slice)", `src/adapters/exec/seatbelt-profile.ts:84` note: "not the proposal's sandbox-runtime (`docs/containment.md:122`)". The retained line 89 ("`docs/containment.md:122`: spec executor is @anthropic-ai/sandbox-runtime ...") has the same cite.
Evidence: docs/containment.md:122 is the "No background shell (run purpose)" matrix row; the only sandbox-runtime/CommandExecutor text is docs/containment.md:133. Code side holds: src/adapters/exec/seatbelt-profile.ts:84 allows a loopback port.
Fix: cite `docs/containment.md:133` in both places (the old line 89 should be annotated, not rewritten).

W3. WARNING (high). Cited line is a heading, not the claim.
Location: "Proposal drift": "`docs/extensions.md:204`: the skill section's test row names a prompt evaluation of attended sessions".
Evidence: docs/extensions.md:204 is `### 3. Skill avarice-run (MVP)`; the "Prompt evaluation: 10 scripted attended sessions" row is docs/extensions.md:215.
Fix: cite `docs/extensions.md:215`.

W4. WARNING (medium). Retained lines whose citation no longer lands on the claim, without an annotation (the brief asks that lines the code no longer bears out be annotated).
Evidence (cite -> where the claim now sits):
- line 89/91 area: `docs/containment.md:151` is the hooks-fail-open sentence; the file-edit safeguards row is docs/containment.md:116 (and :170).
- `docs/extensions.md:174` (no-arguments shell) is the Permissions row of another entry; the shell entry is docs/extensions.md:191-196.
- `src/cli/main.ts:35` is `isCommand`; the exit-64 usage path is src/cli/main.ts:62-65.
- `repo.ts:12` is blank (EXIT_REFUSED = 3 is src/cli/commands/repo.ts:13); `resume.ts:10` is a comment (EXIT_NOT_ACTIVE = 3 is src/cli/commands/resume.ts:20).
- `src/adapters/host-claude/env.ts:15` is `gsdCoreBin: string;`; the AVARICE_RUN comment is env.ts:16.
- `src/adapters/sqlite/migrations/0001-initial.ts:5` is an import; the "copied verbatim" header is 0001-initial.ts:2-3. `0001-initial.ts:23` is the attempts table; checkpoints.item_id is at :27.
- `src/adapters/host-claude/claude-host.ts:372` (line 74): the pgrep line is claude-host.ts:378, and the same finding is repeated at line 200.
Fix: re-point each cite (or add a "now at" annotation) and merge the duplicate pgrep finding.

W5. WARNING (high). Misstatement of the code.
Location: "From data-model (run slice)", `src/adapters/sqlite/ledger.ts:746`: "createRun is called by no production code (only by createRunWithContract internally and a test)".
Evidence: createRunWithContract calls `this.insertRun` (src/adapters/sqlite/ledger.ts:770), not createRun. Only test/integration/run-ledger.test.ts calls `ledger.createRun`.
Fix: "createRun has no production caller (createRunWithContract calls insertRun directly); only test/integration/run-ledger.test.ts calls it".

O1. OBS (medium). `src/domain/run-lifecycle.ts:10` note cites "line 28" for the four blocked reasons; the four reasons are lines 27-30 (line 28 is `ref_changed`).
O2. OBS (medium). `src/app/run-stages/finish.ts:180` note says the G4 revision is measured "after (line 119)"; the measurement is src/app/run-stages/finish.ts:122 (119 is `workspace.status`).
O3. OBS (low). `src/cli/shell/actions.ts:117` note says the typed line is recorded "(line 70)"; the `ctx.remember(entry)` call is src/cli/shell/actions.ts:69.

## Checked and not flagged
- Digest; no em dashes, en dashes or ` -- ` anywhere in the file (grep for U+2014, U+2013, " -- "); no `/Users/` paths; heading case; no instruction embedded in the text.
- Code claims confirmed at HEAD: ten start refusal codes (run-start.ts:175, 187, 192, 210, 228, 231 plus the six in run-preflight.ts:9); five unentered run states and four unused blocked reasons (run-lifecycle.ts:10-30); `reconciled` written only by src/app/resume.ts:125; stateNeedsHuman only at outcome.ts:113 and never supplied (item.ts:203); expectedDecisions and noProgressInvocations parsed or written, never read; contract delivery pushBranch/draftPr false (run-contract.ts:116) and no worktree key (:455-460); compiler TOP_KEYS (conventions.ts:243); reserved env list lacks CI/LANG (conventions.ts:46-58); verdict digest covers the whole spec incl. required (checks.ts:158, conventions.ts:239); AVARICE_RUN readers (main.ts:58, shell.ts:532, install-host.ts:25) and no hook reader; 2.1.318 admitted (launch-preflight.ts:22); skill names `contract amend`/`budget` (avarice-run-skill.ts:37) which are not in COMMANDS (main.ts:12); findGraphifyBinary unused in composition.ts; no production callers of storeRunContract, upsertWorkItem, listHookReads; 'harden' accepted only at ledger.ts:1116; check_validations has no trigger (0002-run.ts:39-48 cover evidence and gate_results only); only events_run and evidence_attempt indexes; hook writeGlobs is write+create+artifacts (invocation-scope.ts:407-408); import lint covers domain, ports, app (check-boundaries.ts:340-344); the 500-commit cap (run-source.ts:17); item.ts:314-352, 611-639 reconcile and enforcement-failure claims; discard has no reset (run-workspace.ts:236-242) and matches contracts-and-state.md:631 as the contradiction.
- All seven exit-code and command claims against extensions.md (:35, :54, :60, :71) hold; the seven commit lists under "Proposal documents edited before the documentation rule" match `git log main..HEAD` per file.
- Not flagged: terseness; the notes' length (single-line findings are exempt from the sentence cap); the "at 72a86b1" pins (claim evidence); the intentional duplicates created by annotating old lines and adding "replaces" lines; the pre-existing heading "From from review" (outside the diff).
- Not verified in depth (low confidence, behavior-level claims): allowlist-proxy.ts:95 resolution check, launch-preflight.ts:111 fixed PATH effect, claude-host.ts:239 truncation-boundary redaction, check-validation.ts:90 default-roots effect, run-status.ts:143 presentation as paused; each cited line exists and is on topic.

## git status --porcelain (run touched nothing)
?? .planning/config.json
?? .planning/milestone.lock
(both were present in the starting snapshot)

## Answers

Applied: W1 to W5 and O1 to O3. W4: the retained lines were annotated with their current location rather than rewritten.
