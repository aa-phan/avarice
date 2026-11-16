# Round 2, group C: fresh prose review (verbatim report). Reviewer: a fresh technical-writer:prose-reviewer, spawned by the orchestrator and given only the documents, the code and the house rules. It read the round 1 report only after its own review. Documents: checks-and-evidence.md, containment.md. Working tree at HEAD 3e5e7d6.

---

VERDICT (round 2, group C): NEEDS CHANGES. One WARNING about a code-behaviour claim in checks-and-evidence.md forces another round. containment.md has no finding above OBS. There are no BLOCKERs.

Digests reviewed, at HEAD 3e5e7d6:
- docs/system/checks-and-evidence.md sha256 173a31ddaea9c6e39e79395f49718b1d70ec60f9d690c708858ff1d640025dfe
- docs/system/containment.md sha256 276f56e1d97bdf628b7a460154deedd0cd30f8fc16b15a31ea9bad28fd18f968

Severity terms: BLOCKER cannot proceed. WARNING is likely rework and, under the gate, blocks. OBS is worth noting. A WARNING is tagged (behaviour) when the claim is about code.

## Findings, most severe first

### W1 WARNING (behaviour), checks-and-evidence.md, "Repair and gate G3", first paragraph (line 237)
- **Claim:** "Any other failure takes the route in the G2 table of runs.md: a scope or deletion failure blocks the run, and the rest open an `acceptance` decision." This reads as covering every failure that is not a checks-only repair candidate.
- **Evidence:** `src/app/run-stages/item.ts:1549-1552` gives a failed repair unit (`isRepair`) the `repeated-failure` signal for any G2 or G3 failure, not only the checks-only case. Only scope and deletion failures leave it, because they become a run-wide `enforcement_failure` (`item.ts:1540-1547`). `src/domain/decision-policy.ts:213-214` classifies `repeated-failure` as `repeated_failure`.
  - The `acceptance` route applies only to a first unit.
  - Example: a repair that fails `test-inventory`, `gsd-verification` or a G3 rule opens a `repeated_failure` decision, not an `acceptance` one.
  - Line 262 ("A repair that fails goes to the decision") is correct but does not name the class.
- **Fix:** Say the `acceptance` route is for a unit that is not a repair. Add that any failure of a repair unit, other than a scope or deletion breach, opens a `repeated_failure` decision.
- **Confidence:** medium-high. The corner is small, but the code contradicts the sentence as written.

### OBS (none blocks)
- **checks-and-evidence.md, G1 text (line 210):** "A plan path outside the contract opens a `scope_expansion` decision". `g1Decision` (`item.ts:1706-1710`) uses the same signal for `plan-within-spec`, a path outside the item's spec files but possibly inside the contract. Suggest "outside the contract or the item's spec files".
- **Both openings, line 3:** The first sentence of each opening runs well past 35 words. checks-and-evidence.md is 55 words, and containment.md is about 96 including its module list. Both were already over the cap at fc15fea. Treat as the reference-list carve-out, or split.
- **containment.md, untouched since fc15fea:** Lines 151 and 152 (the Allow and Deny setting lists, 59 and 81 words) are enumerations. Line 269 is a 37-word sentence.
- **containment.md line 118:** "every choice line matches the options of exactly one other item that owns a choice" simplifies `attributeNumberedChoice` (`src/domain/outcome.ts:151-171`). The code also requires that no line is the unit's own or a shared option, and that no other item shares a line. The simplification is not wrong, and "Any doubt keeps the pause" covers it.

## Behaviour claims checked
V = verified, W = wrong, U = unverifiable.

### checks-and-evidence.md
- V: G1 plan reading. `PLAN_READ_BYTES` is 64 KiB. A file over the limit or not a regular file makes `readText` return `invalid` (`staging-base.ts:145-146`), and `readPlan` then returns a null plan (`item.ts:1597-1606`). The text now says exactly that (round 1 W1 fix).
- V: The G1 parser inputs, the six rules and their order, and `plan-present` judged alone (`gates.ts:191-297`).
- V: G2's eight rules in order (`gates.ts:22-31`), the three evaluation stages (`item.ts:1440-1490`), and G4's seven rules in order (`gates.ts:127-135`).
- V: G3's three rules (`gates.ts:309`). The authorized list is empty (`item.ts:1786`). Both verdicts are stored, and the rows are named `G3:<rule>` and `G2:<rule>` (`item.ts:1496-1499`).
- V: Repair offer conditions: checks-only, all blocking `regressed`, all failing checks ran and failed, not a G3-failed repair (`item.ts:1503-1512`). Limit per check and invocations-budget room (`item.ts:1808-1830`, `repairAttemptsPerCheck` 1 at `run-contract.ts:101`). The invocations-budget block is class `budget` (`decision-policy.ts:216`).
- V: A failing check that goes to a decision without a repair also writes `repair:reproducer` (`item.ts:1530-1536`, `repair.ts:205-219`). Round 1 W4 is fixed.
- V: Reproducer fields and caps of 20, 20, 200 and 1000, output digest only, and the three failing-test shapes (`reproducer.ts`).
- V: The install gets the sandbox values plus proxy, update-notifier and ignore-scripts variables (`checks.ts:381`). The list command gets the sandbox values only (`checks.ts:453`). Checks get the check `env` under the sandbox values (`checks.ts:216`). Round 1 W3 is fixed.
- V: The sandbox values are `PATH`, `HOME`, `TMPDIR`, `npm_config_cache`, `CI` and `LANG` (`checks.ts:135`), matching `SUPERVISOR_CHECK_ENV_NAMES` (`conventions.ts:65`). Validation writes anywhere in the clone and passes no `allowReadPaths` (`check-validation.ts:82-92`).
- V: Only required checks and targets are listed as agent commands (`run-contract.ts:678-681`). The prompt line says no gate judges the others (`run-gsd-config.ts:128`).
- V: G1 decision shapes (`item.ts:1706-1727`). The G4 block is `decision` with class `repeated_failure` (`finish.ts:244-247`). Step names `deps:install`, `checks:validate`, `baseline` and `repair:reproducer` exist (`prepare.ts:159-161`, `repair.ts:29`).
- V: Integrity-gate mapping (`gates.ts:357-361`).
- W: line 237, see W1.
- U (not re-derived by me; round 1 reported them verified): stale-row rules in `amendment.ts` and `ledger.ts`, the baseline prompt wording, the test-inventory marker regexes, and install-lockfile limits.

### containment.md
- V: Launch line. The flag set includes `--allowedTools Glob,Grep`, and a resume swaps only the final pair for `--resume <uuid>` (`launch-args.ts:60-66`). Refusals: the `=` form, a second occurrence, any other value, and `--allowed-tools` (`launch-args.ts:97-133`). The UUID check precedes any write (`claude-host.ts`, diff hunk). Reaping uses `--(session-id|resume) <uuid>` (`claude-host.ts`, diff hunk).
- V: Agents file. The four run agents get the shell note first, then `gsd-executor` its note, then `gsd-verifier` the verifier note (`agents-json.ts:53-57`). Map and intel agents get none. The shell note text matches the doc (`run-shell-rules.ts`). Round 1 W8 is fixed.
- V: Hook admission. Contract commands match on exact words, including leading `NAME=value` words (`hook-decision.ts:455-480`). The never-granted list is `git`, `avarice`, `claude`, `gh`, `curl`, `wget`, `ssh`, `scp` and `sudo`, judged on the first word after the assignments by last path segment, lower-cased (`conventions.ts:65,230-235`). A malformed policy entry fails closed through `assignmentsWellFormed` (`hook-decision.ts` diff). The scope drops commands with `[;&|$`\\<>'"]` and refused program words or denied prefixes (`invocation-scope.ts:455-466`). `npm` and `npx` are lifted only when a listed command's program word is that name (`invocation-scope.ts:520-522`). Sixteen denied prefixes (`invocation-scope.ts:148-165`) and eleven read-only commands (`invocation-scope.ts:85-97`). The assignment-name check includes the lowercase case (`conventions.ts:225-228`), so the round 1 OBS is fixed.
- V: Refusal reasons are fixed text plus policy command names (`run-shell-rules.ts:35-47`).
- V: Owner commands. The three checks run in order: `AVARICE_RUN`, then terminal, then process tree, with the exact reason strings (`identity.ts:25-30`). They run in `usage()` before the profile is resolved (`main.ts:103-112`). A missing context means "needs an interactive terminal" (`contract.ts:59`, `cancel.ts:33`, `decide.ts:60`, `schedule.ts:30`). Ownership refusals and exit 64 apply to `decide`, `cancel` and `schedule` (`decide.ts:197`, `cancel.ts:98`, `schedule.ts:59`). `contract amend` has no ownership check and relies on the store's ownership refusal (`db.ts:112-128`). `owner:<name>` is recorded by `decide` and `contract amend` (`contract.ts:201`, `decide.ts:163`). `digest` refuses only inside a run (`digest.ts:15`).
- V: Process-tree rule. `/bin/ps` is read one process at a time, with a 64-hop cap, a 400-character cut keeping head and tail, and fail-closed on an unreadable or looping chain (`ancestry.ts`). The signature is ` supervise run_<alnum>` (`ancestry.ts:27`).
  - The doc now states the evasion limit honestly: a process reparented to PID 1 has no supervisor on its chain, and no test shows a run cannot produce one. Round 1 W7 is fixed.
  - The "second barrier" wording matches the code. The `avarice` denied prefix and never-granted word are verified.
- V: Subagent limits. 10 per item is (1+2+1+1)x2 rounds, and the concurrent cap is 2 (`run-contract.ts:95-99,208-237`). A budget amendment can raise a limit (`amendment.ts:131`).
- V: The final-text tail is the last 2000 characters, control characters stripped, returned as the outcome's `question` only (`claude-host.ts:258-260`, `stream-json.ts:8-10`). The `decision.opened` event carries no question text (`ledger.ts:1393-1406`).
- V: Admitted host versions are the five listed (`launch-preflight.ts:24`). Check-command environment, reads and writes (`checks.ts:123-139`, `check-validation.ts:82-92`). Cross-item attribution preconditions (`outcome.ts:151-171`, simplified; see OBS).
- V (marked as a design intent or a gap, not a guarantee): the evasion limit above, "Whether a check can then read its clone was not tested", and the "stops accidents only" description of the environment marker.
- U: The 35 rule-ID count is carried by `coverage.md`. I confirmed the entry exists and did not recount.

## Mechanical sweep
- **Dashes:** no em dash, en dash or ` -- ` in either file (grep with Unicode code points).
- **Sentence length:** I stripped bold, skipped code fences, table rows, headings and the opening paragraph, and kept the 35-word cap. checks-and-evidence.md has none over 35 in new text. containment.md has only the pre-existing items in OBS. Round 1's W5 and W9 splits hold.
- **Delivery history:** no phase numbers, plan IDs, threat IDs, SHAs, `.ts` paths or `src/` after the opening in either file. Camel-case tokens are data keys or schema fields, not function names.
- **Headings:** sentence case, and no question or indirect-question headings. "Item start reference" replaces the old heading.
- **Cross-references:** every anchor cited resolves. Checked: runs.md (5), config-reference.md (2), integrations.md, autonomy-and-decisions.md, containment.md `#secret-redaction` and checks-and-evidence.md `#the-baseline`. The sibling files exist.
- **Embedded instructions:** none found in either document.

## Round 1 WARNINGs
- W1 G1 plan-size rule: **resolved.** The text is correct now.
- W2 "Otherwise" misroutes non-checks failures: **partly resolved.** The checks-only and first-unit routes are right and point to runs.md. The repair-unit route is still wrong; see the new W1 above. **Not fully resolved.**
- W3 "sandbox values only" for the install: **resolved.**
- W4 `repair:reproducer` written in two cases: **resolved.**
- W5 sentences over the cap in checks-and-evidence.md: **resolved.**
- W6 indirect-question heading: **resolved.**
- W7 ancestry overstated: **resolved.**
- W8 agents-file description and ordering: **resolved.**
- W9 sentences over the cap in containment.md: **resolved.**

## Read-only sweep
`git status --short` lists `?? .planning/milestone.lock` (present at the start) and three untracked round-2 files, `round-2-A.md`, `round-2-D.md` and `round-2-E.md`, written by other reviewers. I wrote no repository file. My scratch files are under `/tmp/rvC/`. No tracked file changed. The two digests above were re-computed at the end of the run and are unchanged.

## Verdicts
- docs/system/checks-and-evidence.md: needs-changes (one behaviour WARNING, W1 above).
- docs/system/containment.md: pass-with-nits (OBS only, no behaviour discrepancy found; the process-tree and identity claims are honest about what is and is not tested).
