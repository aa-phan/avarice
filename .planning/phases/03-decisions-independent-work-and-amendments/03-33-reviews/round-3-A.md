# Round 3, group A: fresh prose review (verbatim report). Reviewer: a fresh technical-writer:prose-reviewer, spawned by the orchestrator. It read the round 2 report only after its own review. Document: findings.md. Working tree at HEAD 13a7267.

---

Verdict: needs-changes. findings.md has 12 citation WARNINGs, all inline or stale line numbers. None is a BLOCKER. Under the round rules they force another round. Every "now at" re-point in the file that I checked lands correctly; the failures are inline numbers and a few leads that were not re-pointed.

SHA-256 of docs/system/findings.md at HEAD 13a7267 (303 lines): fef6068d80c8cdcd344c6e8750bbb3e89c24d0e34caa01d2f4ee637e31e53b46

Severity key: BLOCKER = cannot proceed. WARNING = wrong citation or claim, fix; a code-behaviour or citation WARNING forces another round. OBS = worth noting. Line numbers below are findings.md line numbers.

How I checked: a script pulled every `src/`, `test/`, `scripts/`, `package.json` and `docs/` file:line citation (about 430 code targets and about 80 doc targets), printed the target line, and I read them against each claim. I then opened the inline "(line N)" and ":N" numbers and the docs/ targets by hand.

WARNINGS (citation does not land on the claimed code or text)

W1. L12: "onboard and resume (resume.ts:19) validate arguments after profile creation".
- src/cli/commands/resume.ts:19 is an import. The validation is at resume.ts:36-37 (`usage(io, 'exactly one onboarding or run ID is required')`).
- Fix: resume.ts:37.

W2. L17: "`src/app/onboarding-service.ts:145`: no stage handles `planning`, yet status.ts:50 marks it interrupted".
- onboarding-service.ts:145 is a blank line. The STAGES map that omits `planning` is at :133-140.
- `status.ts:50` has two problems. src/cli/commands/status.ts has only 22 lines. In src/app/status.ts, :50 is a `for` loop. The `isResumable` interruption test is at src/app/status.ts:58. `planning` is in the resumable set at src/domain/onboarding-lifecycle.ts:68.
- Fix: lead to onboarding-service.ts:133 (or :139), inline to `src/app/status.ts:58`.

W3. L35: "(gsd-graph.ts:120)" for non-code graph nodes being fenced.
- src/adapters/context/gsd-graph.ts:120 is `confidence`. `untrusted: true` for non-code nodes is at :123, with the comment at :122.
- Fix: :123.

W4. L117: "`src/adapters/host-claude/env.ts:17`: the `extraPath` option and its comment".
- env.ts:17 is `onboardingId: string;`. The extraPath comment is at :18 and the option at :19. L70 cites :19 correctly.
- Fix: :18 to :19.

W5. L198: lead "(now at `src/adapters/sqlite/ledger.ts:1197`): a decision is inserted with state 'open'".
- ledger.ts:1197 is the contractVersion validation inside the evidence insert (the INSERT is at :1205). It is not a decision insert.
- The same line's parenthetical gives the decision insert as :1354. That is `openDecision`, and the INSERT itself is at ledger.ts:1371 (`insertDecisionRow`).
- Fix: re-point the lead to 1371, or drop "(now at ...1197)" and keep the later note.

W6. L64: "`docs/contracts-and-state.md:832`: the spec retention table (for example 30 days after run close)".
- Line 832 is a closing code fence of the events DDL. The retention table is at contracts-and-state.md:858-862 (the "30 days after run close" row is :862).
- Fix: :862.

W7-W10. L85, L86, L87 and L88 each cite a docs/containment.md line one too early. The lines shifted when the proposal was edited, and the leads were never re-pointed.
- L85 `containment.md:81`: line 81 is `},`. The registry.npmjs.org network entry is at :82.
- L86 `containment.md:84`: line 84 is `"hooks": {`. The `avarice hook pre-tool-use --run <run>` command is at :85.
- L87 `containment.md:94`: line 94 is blank. The four GSD hooks paragraph is at :95.
- L88 `containment.md:96`: line 96 is blank. The env allowlist paragraph is at :97.
- Fix: :82, :85, :95, :97.
- L82 (:29), L83 (:28), L84 (:60), L89 (:133) and L90 (:134) are correct.

W11. L92: "`docs/containment.md:193`: spec denies agent definitions with permissionMode".
- Line 193 is the wall-clock budget row. The permissionMode and subagent inheritance text is at containment.md:207.
- Fix: :207.

W12. L137: "`docs/system/config-reference.md:159` to `:162` and `:169` list `paths.read`, `paths.generated`, `commands` and `verificationByChangeType`".
- config-reference.md:159-162 are agentCommands character and word rules. :169 is the whole-file limit.
- The onboarding-reader key rows are at :178-181. The sentence that the run reader refuses those four keys is at :188.
- Fix: ":178 to :181 and :188".

OBS
- O1. L9 "usage exit path ... `main.ts:75` to `:78`": :75 is a closing brace. The usage exit is :76-78. Say ":76 to :78".
- O2. L28 "SQLite gate (src/adapters/sqlite/db.ts:97)": :97 is a `catch` inside `checkRuntime` (starts :93). The verdict check follows a few lines later. The cite is inside the right function but does not show the claim.
- O3. L140 "`supervise.ts:48`: SIGTERM ends the supervisor at once": :48 is the `runSupervisor` call. supervise.ts installs no SIGTERM handler, and none exists outside the executor and host adapters, so the claim holds by absence. The citation does not show it. Consider saying so ("no handler is installed").
- O4. L74 and L216 state the same reaping fact. L74 says "repeated under From integrations (run slice)", so this is acknowledged and I did not escalate it.
- O5. Sentence-length sweep: my tokenizer is crude (code spans collapse to one word, bullets are not split on semicolons). It flagged L9, L63, L113, L134, L145, L155, L224, L226 and L231 as candidates above 45 words. I did not verify them against the 35-word cap. Round 2 reported nothing over the cap. Please recheck those lines if the cap applies to ledger bullets here.

CLAIMS CHECKED AND VERIFIED (not flagged)
- Every "now at" re-point in the file landed on code that matches its claim. Sampled and read, among others: composition.ts:175, :173, :30, :290; ledger.ts:237, :509, :531, :603, :743, :763, :783, :940, :951, :1107, :1207, :1283, :1294, :1354, :1412, :1462, :1506, :1703; hook-decision.ts:249, :271, :278, :539, :668, :809, :839; item.ts:390, :594, :608, :634, :1010, :1156, :1176, :1191, :1862, :1891; run-contract.ts:102, :111, :112, :407, :669, :676, :703, :711, :749; checks.ts:95, :136, :171, :174, :216, :221, :234, :243, :250, :381, :465; launch-preflight.ts:68, :113, :143, :237; claude-host.ts:157, :244, :249, :260, :387; blocked.ts:144, :226; run-start.ts:177, :189, :194, :212, :233, :255.
- The claim text matched the code at those targets, for example the `expectedDecisions` unread claim, the `question` field now filled at claude-host.ts:260, `detectPause` and `stateNeedsHuman`, and the `checksToRun` scope.
- The "Resolved at" and commit-pinned items (f1a4d8c, 9323ed3, 5878368, d16fad6) were taken from round 2, which verified that the commits exist. I did not re-open them.
- Every autonomy-section citation (L246-262) landed.
- Test citations (L274-278) landed, including the inline lines 299, 309 and 320.
- Mechanical sweep: no em or en dashes anywhere. The two ` -- ` hits (L74, L216) are inside code spans. Headings are sentence case. The `file:line` citations are permitted in this file.
- Delivery history (commit IDs, "Phase 1" and "Phase 2" quoted from code strings) appears as claim evidence or quoted code, which the doctrine permits.
- The "findings.md:89 and :91" self-references (L188, L189) land on the intended lines.

ROUND 2 FOLLOW-UP (round-2-A.md, read only after my own review)
- W1, `run-start.ts` inline numbers: resolved. 177, 189, 194, 212 and 233 are correct.
- W2, `item.ts:314` line inline numbers: resolved. :608 is the clone HEAD read and :634 is the moved-HEAD check.
- W3, `item.ts:611` line: resolved. :1191 is the enforcement classification.
- W4, `ledger.ts:1106` line, "harden": resolved. :1294.
- O1, `finish.ts` "lines 121 to 126": resolved.
- O2, ancestry.ts:56: resolved. :56 is inside the parent walk.
- O3, launch-preflight "now at :143": resolved.
- O4, the unverifiable negative claim: accepted as a stated gap.
- Round 2 reported "about 120 targets, all correct except W1 to W4". Its sampling missed the docs/ targets (W6 to W12) and the older inline numbers (W1 to W4 above). The defect class it described (an inline number left behind when only the lead moved) is the same one that remains.

READ-ONLY PROOF
`git status --short` shows `.planning/milestone.lock` (present at the start) and two untracked reviewer files, round-3-C.md and round-3-D.md. Those were created by other reviewers, not me. `git diff --stat` is empty. I wrote only /tmp/cites.txt, /tmp/s.py and /tmp/r.py, outside the repository.

Relevant path: /Users/aphan/avarice/.claude/worktrees/phase-03/docs/system/findings.md (lines 12, 17, 35, 64, 85-88, 92, 117, 137, 198).
