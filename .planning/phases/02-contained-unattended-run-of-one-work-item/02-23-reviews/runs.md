Reviewed: docs/system/runs.md sha256 63abd09e1c85943fd71ad40839156487aa4b8e04d5340cd6ed62cdb7310cee2b at 0632fd4b66bdf15f858396ef8d65761f848ac448
Verdict: VERDICT: BLOCKED. No BLOCKER found, but two WARNING-level factual errors, further WARNINGs (sentence cap, event list, bad citations in findings.md) and several OBS remain. This gate treats any WARNING as blocking.

VERDICT: BLOCKED. No BLOCKER found, but two WARNING-level factual errors, further WARNINGs (sentence cap, event list, bad citations in findings.md) and several OBS remain. This gate treats any WARNING as blocking.

Digest reviewed: SHA-256 63abd09e1c85943fd71ad40839156487aa4b8e04d5340cd6ed62cdb7310cee2b, matches the expected digest. HEAD is 0632fd4b66bdf15f858396ef8d65761f848ac448. Severity vocabulary: BLOCKER (cannot proceed), WARNING (rework, and blocking at this gate), OBS (worth noting).

FINDINGS (most severe first)

1. WARNING, high confidence. Wrong default roots, lines 52 and 189.
   - runs.md says the data root is "`~/.local/share/avarice/runs/<runId>/`" and the work root is "`~/.local/share/avarice-work`".
   - Both defaults carry the profile segment `personal-local`, so the real defaults are `~/.local/share/avarice/personal-local/runs/<runId>/` and `~/.local/share/avarice-work/personal-local`.
   - Evidence: src/adapters/fs/profile-paths.ts:63-64; docs/system/config-reference.md:20-21.
   - Fix: add the segment, or drop the default and point to config-reference.md.

2. WARNING, high confidence. Preparation step 6, line 194: "the host must report enforcement as enforced, else the run is `blocked_on_decision` with `enforcement_failure`".
   - Only a host failure gets `enforcement_failure`. A static G0 failure at this step gets reason `decision`.
   - Evidence: src/app/run-stages/prepare.ts:372-390 (`reason: hostFailed ? 'enforcement_failure' : 'decision'`).
   - Fix: state both reasons.

3. WARNING, high confidence. Resume, line 289: "`running`, item in flight: the run is paused (reason `interrupted`) around the reconcile".
   - The pause happens only when the item is `delegated`. A `gated` item is reconciled with no pause.
   - Evidence: src/app/run-resume.ts:250-251 (`item?.state === 'delegated' && current.state === 'running'`).
   - Fix: restrict the pause to a delegated item.

4. WARNING, high confidence. Status section, line 304: "Every value is an ID, a state, a status, a revision or a count."
   - The inbox returns `issue` (a text, possibly the unit's own question stored as data), plus `title` and the repository path.
   - Evidence: src/app/run-status.ts:222-239 (`InboxDecision.issue`, `InboxReview.title`, `repository`).
   - Fix: say what the inbox does return, or drop the claim.

5. WARNING, medium-high confidence. Sentences over the 35-word hard cap in running prose, per `references/style.md`.
   - I counted 30 sentences over the cap. Worst cases:
     - Line 5 (76 words, a module list, so partly covered by the list carve-out).
     - Line 7 (67 and 49 words).
     - Line 177 (77), line 204 (75, 55, 37), line 241 (66).
     - Line 271 (58), line 208 (52), line 223 (55), line 58 (53), line 20 (52).
     - Lines 278, 306, 282, 293 and 247.
     - Quirk bullets at lines 331 and 335.
   - Fix: split at the semicolons and colons.

6. WARNING, medium confidence. Events are not covered exhaustively.
   - runs.md names only `handoff.fetched` and `containment.finding`, plus "an event names each interrupted invocation".
   - The run code also writes `invocation.reaped`, `invocation.interrupted`, `invocation.orphan-charged`, `verification.interrupted` and `invocation.finished`.
   - Evidence: src/app/run-resume.ts:73 and :97; src/app/budget.ts:109; src/app/run-resume.ts:~215 (`verification.interrupted`).
   - data-model.md (the cited owner of events) lists only `invocation.reaped`, `invocation.orphan-charged` and `containment.finding`. `handoff.fetched`, `verification.interrupted` and `invocation.interrupted` are in neither document.
   - Fix: list the run events in runs.md, or add them to data-model.md and point there.

7. WARNING, high confidence. Wrong `file:line` citations in docs/system/findings.md, section "## From runs". Each cited line exists but does not say what the finding claims.
   - `src/app/run-resume.ts:57` is the `interrupted` lookup. The stopped-state return is at :47.
   - `src/domain/run-lifecycle.ts:146` is `['ready','delegated']`. The item edge `blocked_on_decision` to `ready` is at :152.
   - `src/app/run-stages/discard.ts:15` is an import. `DISCARD_BASIS` is at :19.
   - Fix: update these three citations.

8. OBS, high confidence. More loose citations in findings.md.
   - `src/domain/run-contract.ts:106` is `repairAttemptsPerCheck`. `repairAttemptsReason` is at :107.
   - `src/adapters/sqlite/ledger.ts:938` is `this.lockRun`. The status check is at :940 (`recordRunStep` starts at :936).
   - `src/adapters/git/run-workspace.ts:249` is inside `discard()`, which starts at :242. It is not the line that shows "no reset".
   - `docs/system/config-reference.md:71` is the table header. The four listed keys are at :74-77.

9. OBS, medium confidence. Contract `budgets` surface, line 129: "See below" never mentions `repairAttemptsPerCheck`, `repairAttemptsReason` or `retry`.
   - Evidence: src/domain/run-contract.ts:49-52 and :105-109.
   - The retry limit is the "one retry" that Stages describes.

10. OBS, high confidence. Line 193: "every usable required check runs once" at the baseline.
    - Targeted checks run too. Evidence: src/app/checks.ts:87-90 (`checksToRun` takes required and targeted) and src/app/run-stages/prepare.ts:293.

11. OBS, medium confidence. Lines 278 and 330 contradict each other.
    - Line 278 says "Every block opens one decision record". Line 330 says the enforcement-check block opens none.
    - Evidence: src/app/run-stages/prepare.ts:387.
    - Fix: line 278 should say "every block routed through the block step".

12. OBS, medium confidence. Line 293: "the run is shown `paused (verification interrupted)`".
    - The reconcile makes a real ledger transition `verifying` to `paused` (src/app/run-resume.ts:~203).
    - Lines 289, 293 and 306 mix this real transition with the `status` presentation of an interrupted run. The wording "shown" blurs the two.
    - The `paused` reason travels as event data, not as a blocked reason, so "reason `interrupted`" is also ambiguous next to line 158.

13. OBS, medium confidence. Containment table row "The model committing" is labeled "Detects; blocks, never recovers".
    - The hook denial is prevention, and the table's own header asks for that distinction.
    - Evidence: src/domain/hook-decision.ts:~520 (`shell-not-allowed`, so a git commit is denied by the allowlist).
    - This under-claims, so it is not an overclaim.

14. OBS. Links.
    - checks-and-evidence.md does not exist yet (lines 7, 196, 247), as expected for this plan.
    - processes.md exists and resolves.
    - All other links resolve (onboarding, containment, data-model, cli-reference, config-reference, integrations).

CHECKED, NOT FLAGGED

- Integrity and house rules: no dash forms; no delivery history in the prose; no secrets, transcript text or absolute home paths (`~/` defaults only at lines 52 and 189, see finding 1); no prose paths or function names outside the opening paragraph (data-artifact names allowed); modules named once in the opening; sentence-case headings and a Quirks section last; the drafted banner matches sibling documents; no embedded instruction.
- Start refusals: the ten codes are right (four in src/app/run-start.ts at lines 175, 187, 192, 210 and 231, plus six in src/domain/run-preflight.ts:9); preflight order, the 25 commit and 14 day limits and the check order match; coverage.md "10 of 10" is correct.
- Start and CLI behavior: exit codes and flags for start, supervise and resume match src/cli/commands/*; detached spawn conditions match src/cli/spawn-supervisor.ts (absolute entry path, own process group, ignored streams, data root as cwd, 250 ms poll, 15-minute margin, 24 h resume wait); contract file written 0600 in a 0700 directory and rewritten by the supervisor.
- Brief and conventions: brief format matches src/domain/brief.ts exactly; conventions reader keys and refused command words match src/domain/conventions.ts; the 500-commit walk and 256 KiB limit match src/adapters/git/run-source.ts.
- Contract, lifecycle and budgets: top-level sections, G0 static rules, protected-path and override rules match src/domain/run-contract.ts; lifecycle table (11 states, 37 edges), seven blocked reasons, six step statuses, six work-item states and five stored budget rows match.
- Stages and gates: next-action lists, the seven GSD settings, prompt limits, classification order, routing table, retry and discard behavior, G2 and G4 rules, commit identity and trailers and hand-off semantics match.
- Resume and status: reap, spend and reconcile order matches; interrupted-run sort order matches.
- Grounder leads: lines 191-192 install and check-validation claims are supported by src/app/checks.ts:338-390 and src/app/run-stages/prepare.ts; nothing claimed from src/app/check-validation.ts beyond the `blockingOf` mapping (verified at lines 184-196); "once at the pin" baseline claim and the 180 s lease TTL default (test-only override) are correct.
- Containment claims: prevention, detection and recovery labeled correctly; no enforcement claim the code does not perform. Checked: G0 verdict decided once per process (src/adapters/host-claude/claude-host.ts:97-120); launch self-test (:166); denyWrite lists only existing entries (src/domain/invocation-scope.ts:454-456); GSD settings not re-read after config-set (src/adapters/gsd/gsd-onboarding.ts:184).
- findings.md and unknowns.md: unknowns "From runs" entries cite files and ranges that exist; the other findings citations check out; only those in findings 7 and 8 failed.
- Not flagged: "simply" at line 48, and terseness in the findings.

I modified no file. The only extra files are scratch scripts under /tmp.

git status --porcelain:
?? .planning/config.json
?? .planning/milestone.lock
(unchanged from the start of the run)

## Answers

Applied: findings 1 to 4 and 6 and 7 (default roots with the profile segment; both reasons at the enforcement check; the pause only for a delegated item; the inbox free-text fields named; the run events listed with a pointer to the event list; the three wrong citations corrected). Finding 8: the four loose citations were corrected (`src/domain/run-contract.ts:107`, `src/adapters/sqlite/ledger.ts:940`, `src/adapters/git/run-workspace.ts:242`, `docs/system/config-reference.md:74` to `:77`). OBS 10 to 13 were applied (targeted checks at the baseline, the block-step scope of "every block", the real transition versus the `status` presentation, and the prevention label of the hook allowlist).

Finding 5 (sentence cap): every running-prose sentence over 35 words was split, counted by script (a sentence counts its words with inline code spans as one word each). The one exception is the opening paragraph, whose long sentence is the list of modules that CLAUDE.md requires an opening to name; a list is exempt from the cap.

OBS 9 (the `budgets` row in the contract table does not mention the retry fields): left as is. The "one retry" is described under Stages, and the stored repair fields (`src/domain/run-contract.ts:105` to `:109`) carry no behavior of their own. OBS 14 (links): `checks-and-evidence.md` now exists in the tree.
