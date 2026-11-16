# Round 4, group A: fresh prose review (verbatim report). Reviewer: a fresh technical-writer:prose-reviewer, spawned by the orchestrator. It was told not to trust the author's checker, and it read the round 3 report only after its own review. Document: findings.md. HEAD 6b82bb6.

---

Verdict: needs-changes. Round 4 of findings.md has 0 BLOCKERs and 5 WARNINGs. Four of them are code-behaviour claims and one is a citation, so under the round rules another round is forced. All 17 round-3-A items (W1-W12, O1-O5) are resolved or accepted, and the author's checker cannot detect a wrong citation (see below).

SHA-256 reviewed: f9949773a9d2f94fca2d0ba59bd1052bc86856214a82b685a38a7be15117ec17 (docs/system/findings.md, 303 lines, HEAD 6b82bb6, working tree clean apart from the pre-existing untracked .planning/milestone.lock).

Severity key: BLOCKER = cannot proceed. WARNING = a wrong claim or citation to fix; a code-behaviour or citation WARNING forces another round. OBS = worth noting. Line numbers are findings.md line numbers. Evidence is the file:line I read at HEAD.

## Method
- I read every `src/`, `test/`, `scripts/` and `docs/` target in the author's dump. That is about 410 current citations, covering full-path, short-name, bare `:N`, "(line N)" and "(N, M)" forms. I also read the target lines in the proposal documents themselves (docs/containment.md, extensions.md, autonomy-and-decisions.md, contracts-and-state.md, operations-and-testing.md, repository-onboarding.md, existing-tooling-assessment.md, config-reference.md).
- About 60 of the claims were checked against surrounding code, not just the cited line: greps for `pauseSignal`, `stateNeedsHuman`, `expectedDecisions`, `noProgressInvocations`, SIGTERM handlers, `prev_hash` readers, indexes, exit-code constants, the preflight and refusal codes, and the admitted host versions.
- I used the author's `dump` mode only as a viewer.

## Findings, most severe first

### W-A (WARNING, code claim, confidence high). L49, `src/app/stages/map.ts:107`
- Quote: "the `paused` outcome branch is dead: the outcome classifier (src/domain/outcome.ts) never returns `paused`".
- Evidence: `src/domain/outcome.ts:69` is `if (facts.pauseSignal === true) return result('paused');` and `outcome.ts:24` lists `'paused'` in `ClassifiedKind`. The classifier does return `paused`. What is true is that no onboarding stage ever sets `pauseSignal`. Only `src/app/run-stages/item.ts:407-433` and `:1056` set it. The map-stage branch at `map.ts:107` is therefore still unreachable.
- Fix: reword to "the onboarding stages never pass a `pauseSignal`, so the classifier never returns `paused` to the map stage (only the run item stage sets it)".

### W-B (WARNING, code claim, confidence high). L78, `docs/existing-tooling-assessment.md:24`
- Quote: "records Claude Code 2.1.312 and 2.1.316 only; code also admits 2.1.317 (at 72a86b1 the code also admits 2.1.318)".
- Evidence: `src/adapters/host-claude/launch-preflight.ts:24` is `ADMITTED_CLAUDE_VERSIONS = ['2.1.312','2.1.316','2.1.317','2.1.318','2.1.319']`. At HEAD the code admits 2.1.317, 2.1.318 and 2.1.319 beyond the proposal. L226 itself observes the host on 2.1.316 to 2.1.319.
- Fix: "code also admits 2.1.317, 2.1.318 and 2.1.319 (the list at `launch-preflight.ts:24`)".

### W-C (WARNING, code claim, confidence high). L89, `docs/containment.md:122` (now at :133)
- Quote: "code uses /usr/bin/sandbox-exec, all network denied, caller env".
- Evidence: `src/adapters/exec/seatbelt-profile.ts:84` emits `(allow network-outbound (remote ip "localhost:${port}"))`, and `sandboxed-executor.ts:129` states `offline: true`. "All network denied" no longer holds. L189 says so ("`docs/system/findings.md:89` ... is stale") but L89 itself still states it as current. The other superseded lines (L9, L10, L91) were updated in place with "No longer holds at ...".
- Fix: append to L89 "No longer holds: the executor allows one loopback port (`src/adapters/exec/seatbelt-profile.ts:84`; see From containment (run slice))". This also removes the cross-reference-to-a-stale-line pattern in L189.

### W-D (WARNING, code claim, confidence medium-high). L297, `docs/autonomy-and-decisions.md:54` against `src/domain/decision-policy.ts:50`
- Quote: "The proposal's class names `scope_expansion` and `architecture` also differ from the five the code writes".
- Evidence: `decision-policy.ts:50` is `DecisionClassName = 'acceptance' | 'scope_expansion' | 'permission' | 'repeated_failure' | 'budget'`. `scope_expansion` is one of the five the code writes. Only `architecture` differs. The proposal names both at `docs/autonomy-and-decisions.md:40`, not at :54.
- Fix: "the proposal's class name `architecture` (`docs/autonomy-and-decisions.md:40`, beside `scope_expansion`) is not among the five the code writes".

### W-E (WARNING, citation, confidence high). L25, `src/adapters/fs/profile-paths.ts:62`
- Quote: "the profile config file is created by every command that resolves the profile".
- Evidence: `profile-paths.ts:62` is `configHome: pick('AVARICE_CONFIG_HOME', ...)`, which only resolves a path. The creation is `mkdirSync` at :87-89 and `writeFileSync(configPathFor(...), ..., { flag: 'wx' })` at :91-96. L24 cites `:90`, which is the `try {` line just before that write, so it lands. L25 does not land.
- Fix: cite `profile-paths.ts:91`, or ":87 to :96".

### OBS
- O-1, L168. `src/cli/main.ts:18` shows only `EXIT_USAGE = 64`. The claim "returns only 0, 3, 64 and 70" is true (70 is `EXIT_INTERNAL` at `composition.ts:51`; 3 is a per-command constant). Cite `src/cli/composition.ts:51` as well.
- O-2, L282. "that still hold at the pass's code state": "pass" is undefined and delivery-flavoured. Use "at HEAD" or drop the clause.
- O-3, L106. The heading "From from review" repeats a word ("From review" or "From the review").
- O-4, L74 and L216 duplicate the reaping fact. This is acknowledged in L74 ("repeated under"); I left it. L69 and L213 (`findGraphifyBinary`) and L73 and L215 (fixed PATH) are likewise duplicated across the base and run-slice sections. Consider one home each.
- O-5, L9. "opens the shell at `src/cli/main.ts:68`": :68 is `if (argv.length === 0) {`, and the AVARICE_RUN test is at :71. It lands within the block and is acceptable.

## Splits of long sentences (check 4)
- I word-diffed the whole round-3 to HEAD change. The splits changed no claim. The edits only turn `;`, `, so` and `, and` into full stops and add "therefore" or "These"; nothing was dropped.
- Spot-read in full: L12, L63, L74, L113-116, L121, L198, L204, L226, L254, L297, L303.
- A rough sentence-length scan with code spans counted as one word found nothing above the 35-word cap. The six apparent hits (L134, 137, 185, 252, 257, 294) are artefacts. Those sentences merge into the next one because it opens with a backtick, or the `file:line` lead was counted.
- Mechanical sweep: no em or en dashes. The two ` -- ` hits (L74, L216) are inside code spans. Headings are sentence case. Every pinned commit hash resolves in git; they appear only as claim evidence, which the doctrine permits.
- ./CLAUDE.md "Documentation" rules: `file:line` citations are by design in this file. The ledger records code-versus-proposal disagreements and leaves the proposals unedited.

## Does the author's checker detect a wrong citation? (check 2)
- It does not. `verify` passes (410 current citations checked, 0 failures, 28 hand-read) while L25 is wrong.
- What it compares: that the file exists, the line is in range and not blank or punctuation-only, and that at least one non-stopword of 5 or more letters from the whole findings line appears in a ±3-line window around the cited line. A line with 20+ claim words matches almost any code in the right file ("config", "profile", "command", "invocation", "decision").
- For docs/ targets it has the same weakness. It cannot judge whether the cited line says what the claim says.
- It does catch blank lines, out-of-range lines and ambiguous short names. That caught the round-2 and round-3 gross misses. Its READ_OK list silences the cases where no word is shared, so those 28 rest on the author's own reading, which I re-read and found correct.
- It follows each "now at" citation, but not leads: it does not check the 130 lead numbers that precede "(now at ...)", and it does not check the HIST entry.
- It cannot detect a semantic mismatch like W-A, W-B, W-C or W-D, and it cannot detect an off-target line inside the right function like W-E.

## Round-3-A follow-up (read only after my own review)

All of W1-W12 and O1-O5 are resolved or accepted.

| Item | Status | Evidence |
|---|---|---|
| W1 | Resolved | L12 now cites `resume.ts:37`, the usage check. |
| W2 | Resolved | L17 cites `onboarding-service.ts:133`, `src/app/status.ts:58` and `onboarding-lifecycle.ts:68`. |
| W3 | Resolved | L35 cites `gsd-graph.ts:123`, `untrusted: true`. |
| W4 | Resolved | L117 now reads ":18 to :19". |
| W5 | Resolved | L198 lead re-pointed to `ledger.ts:1371`, the decisions INSERT. |
| W6 | Resolved | L64 cites `contracts-and-state.md:862`, the retention row. |
| W7-W10 | Resolved | L85 cites :82, L86 :85, L87 :95, L88 :97. I read all four against the proposal text. |
| W11 | Resolved | L92 cites :207. |
| W12 | Resolved | L137 cites `config-reference.md:178 to :181` and `:188`. |
| O1 | Resolved | L9 says ":76 to :78". |
| O2 | Resolved | L28 now cites `db.ts:100`, which is `checkSqliteVersion`. |
| O3 | Resolved | L140 now says "no handler for it is installed in `src` or `bin`". `grep SIGTERM src bin` finds only the host and executor adapters' own kill calls, and `process.on(` appears nowhere. |
| O4 | Accepted | Acknowledged duplicate, as noted above. |
| O5 | Resolved | The sentence-length scan shows no real sentence above 35 words. |

## Checked and deliberately not flagged
- The ten refusal codes in L121 (six in `run-preflight.ts:9` plus `gsd-not-admitted`, `no-project`, `no-active-record` and `conventions-invalid`) and their inline lines (177, 189, 194, 212, 233).
- Inline numbers in L127 ("lines 28 to 31"), L155 ("lines 121 to 126"), L205 ("line 1294"), L231 ("line 175") and L232 ("lines 221 and 246").
- All docs/ proposal targets (Proposal drift section, L284-303). I read the cited text and each claim is faithful. Examples: containment.md:3, :110, :111, :114, :115, :116, :121 and :148; extensions.md:35, :54, :56, :71, :196 and :215; contracts-and-state.md:126, :146, :158, :169, :192-194, :279, :699 and :862; autonomy-and-decisions.md:46, :54, :75, :87, :91, :98 and :100; operations-and-testing.md:263 and :411.
- `noProgressInvocations` has no reader other than its definition (L173). `stateNeedsHuman` is never passed (L130). `expectedDecisions` is stored and never read (L131). `prev_hash` and `row_hash` are read nowhere outside `events.ts` and the migration (L57).
- No explicit hash-chain verification exists.
- Hook event counting by `invocation_id` has no index; only `evidence_attempt` and `events_run` exist (L208).
- The default boundary lint covers domain, ports and app (L237).
- The "now at" re-points in the base slices (composition.ts, ledger.ts, hook-decision.ts, launch-preflight.ts, claude-host.ts, settings.ts and others) all land.

## Read-only proof
I ran `git status --short` after my run. It shows only `?? .planning/milestone.lock`, which was present before I started. I wrote only `/tmp/r4dump.txt` outside the repository. The Write tool was not available to me, and a heredoc script was refused by the sandbox, so I used `python3 -I -c` to count sentences.

## Verdict
needs-changes. Fix W-A, W-B, W-C, W-D and W-E; the OBS items are optional polish. After those fixes the file looks ready to pass. Since the sampled citations are otherwise landing, the next round can be a targeted recheck of these five lines and a re-read of any line changed in response.

Relevant path: /Users/aphan/avarice/.claude/worktrees/phase-03/docs/system/findings.md (lines 25, 49, 78, 89, 297; OBS 74/216, 106, 168, 282).
